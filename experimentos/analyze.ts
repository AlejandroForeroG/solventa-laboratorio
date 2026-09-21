import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { measuredStart, phaseAt, type Run, type Operation } from '../backend/shared/contracts';
import { reconcileProvider } from './reconcile';
import { readClientLedger, reconcileClient } from './client-ledger';
import { incidentReport } from './incidents';
import { analyzeProbes } from './probe-analysis';
export function wilson(x: number, n: number) {
    if (n === 0)
        return null;
    const z = 1.96, p = x / n;
    return (p + z * z / (2 * n) - z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / (1 + z * z / n);
}
export function percentile(values: number[], fraction: number) {
    if (!values.length)
        return null;
    const sorted = [...values].sort((a, b) => a - b), index = (sorted.length - 1) * fraction;
    return sorted[Math.floor(index)] + (sorted[Math.ceil(index)] - sorted[Math.floor(index)]) * (index % 1);
}
type ApiEvent = {
    instrumentationVersion?: number;
    providerDispatched?: boolean;
    providerAbortAt?: number;
    cancelledAt?: number;
    traceId: string;
    operation: Operation;
    phase: string;
    classification: string;
    providerAttempt?: boolean;
    probe?: boolean;
    source?: string | null;
    definitiveOffer?: boolean;
    reason?: string;
    snapshotRead?: boolean;
    instanceId: string;
    startedAt: number;
    finishedAt: number;
    breakerBefore?: string;
    breakerAfter?: string;
    providerMs?: number;
};
type ProviderEvent = {
    requestId: string;
    operation: Operation;
    instanceId: string;
    receivedAt: number;
    phase: string;
};
export async function analyze(directory: string, evidenceDirectory = directory) {
    const config = JSON.parse(await readFile(`${directory}/run.json`, 'utf8')) as {
        run: Run;
        baseUrl: string;
        diagnostic: boolean;
        rate: number;
    };
    const stats = Object.fromEntries(['quote', 'profile'].map(op => [op, { emitted: 0, complete: 0, classes: { normal: 0, degraded: 0, denied: 0, technical_error: 0 } as Record<string, number>, latencies: [] as number[], attempts: 0 }]));
    let dropped = 0;
    const droppedByPhase: Record<string, number> = { warmup: 0, conditioning: 0, measured: 0, pending: 0, finished: 0 };
    for await (const line of createInterface({ input: createReadStream(`${directory}/k6-raw.jsonl`), crlfDelay: Infinity })) {
        const point = JSON.parse(line);
        if (point.type !== 'Point')
            continue;
        const d = point.data;
        if (point.metric === 'dropped_iterations') {
            dropped += d.value;
            const phase = phaseAt(config.run, Date.parse(d.time));
            droppedByPhase[phase] += d.value;
        }
        if (d.tags?.phase !== 'measured' || !stats[d.tags?.operation])
            continue;
        const s = stats[d.tags.operation];
        if (point.metric === 'bank_emitted')
            s.emitted += d.value;
        if (point.metric === 'bank_complete')
            s.complete += d.value;
        if (point.metric === 'bank_classified')
            s.classes[d.tags.classification] += d.value;
        if (point.metric === 'bank_e2e_ms')
            s.latencies.push(d.value);
        if (point.metric === 'bank_provider_attempts')
            s.attempts += d.value;
    }
    const rows = JSON.parse(await readFile(`${evidenceDirectory}/server-events.json`, 'utf8')) as {
        kind: string;
        body: string;
    }[];
    const api = rows.filter(r => r.kind === 'api').map(r => JSON.parse(r.body) as ApiEvent);
    let clientReconciliation: ReturnType<typeof reconcileClient> | undefined;
    let clientEvents: Awaited<ReturnType<typeof readClientLedger>> = [];
    try {
        clientEvents = await readClientLedger(`${directory}/client-events.jsonl`);
        clientReconciliation = reconcileClient(clientEvents, api);
    }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            throw error;
    }
    const providers = rows.filter(r => r.kind === 'provider').map(r => JSON.parse(r.body) as ProviderEvent);
    const ends = rows.filter(r => r.kind === 'provider_end').map(r => JSON.parse(r.body) as ProviderEvent);
    const m = api.filter(r => r.phase === 'measured');
    const mitigatedDependencyFailures = m.filter(r => (r as ApiEvent & {
        technicalDependencyFailure?: boolean;
    }).technicalDependencyFailure === true).map(r => ({ traceId: r.traceId, operation: r.operation, reason: r.reason }));
    const privacyViolations = m.filter(r => (['revoked', 'expired', 'absent'].includes(config.run.fixture) && (r.source === 'snapshot' || r.definitiveOffer)) || (config.run.fixture === 'revoked' && (r.providerAttempt || r.snapshotRead || r.source))).length;
    const begin = measuredStart(config.run);
    const serverWindowCalls = providers.filter(r => r.receivedAt >= begin + 30000 && r.receivedAt < begin + 90000).length;
    const results = Object.fromEntries(Object.entries(stats).map(([operation, s]) => {
        const p95 = percentile(s.latencies, .95), p99 = percentile(s.latencies, .99), lower = wilson(s.complete, s.emitted);
        const server = m.filter(r => r.operation === operation);
        const expected = config.rate * (operation === 'quote' ? .7 : .3) * config.run.measuredMs / 1000;
        return [operation, { emitted: s.emitted, complete: s.complete, classifications: s.classes, p50: percentile(s.latencies, .5), p95, p99, wilsonLower: lower,
                fallbackRatio: s.emitted ? s.classes.degraded / s.emitted : null, providerAttempts: s.attempts, serverResponses: server.length,
                reconciled: server.length === s.emitted && new Set(server.map(r => r.traceId)).size === server.length && Object.values(s.classes).reduce((a, b) => a + b, 0) === s.emitted && s.latencies.length === s.emitted,
                loadComplete: s.emitted >= expected * .99, latencyPass: p95 !== null && p99 !== null && p95 <= (operation === 'quote' ? 250 : 400) && p99 <= (operation === 'quote' ? 500 : 800), completenessPass: lower !== null && lower >= .999 }];
    }));
    const providerReconciliation = reconcileProvider(api, providers, ends);
    const receiptReconciled = providerReconciliation.reconciled;
    const completionRequired = api.some(r => r.instrumentationVersion === 2);
    const providerCompletionReconciled = !completionRequired || providerReconciliation.completionReconciled;
    const probeAnalysis = analyzeProbes(api);
    const basic = Object.values(results).every(r => r.reconciled && r.loadComplete && r.latencyPass && r.completenessPass);
    const clientLedgerRequired = (config as {
        clientLedgerVersion?: number;
    }).clientLedgerVersion === 1;
    const clientLedgerValid = clientReconciliation ? clientReconciliation.reconciled && Object.entries(results).every(([operation, r]) => {
        return r.emitted === api.filter(x => x.phase === 'measured' && x.operation === operation).length;
    }) : !clientLedgerRequired;
    const valid = Object.values(results).every(r => r.reconciled && r.loadComplete) && receiptReconciled && providerCompletionReconciled && dropped === 0 && clientLedgerValid && probeAnalysis.missingEvidence.length === 0;
    const specific = config.run.caseId === 'E01' ? m.every(r => r.classification === 'normal') : config.run.caseId === 'E02' ? Object.values(results).every(r => r.fallbackRatio !== null && r.fallbackRatio < .05) : true;
    return { runId: config.run.runId, evidenceDirectory, caseId: config.run.caseId, phase: config.run.phase, diagnostic: config.diagnostic, results, dropped, droppedByPhase, clientReconciliation: clientReconciliation ?? { available: false }, privacyViolations, receiptReconciled,
        incidents: incidentReport(clientEvents, api, providers, ends), mitigatedDependencyFailures, providerReceipts: providers.length, providerCompletions: ends.length, providerReconciliation, providerCompletionReconciled, serverWindowCalls, probeViolations: probeAnalysis.violations, probeAnalysis, valid,
        status: config.diagnostic ? 'DIAGNOSTICO_SIN_VEREDICTO' : !valid ? 'INCONCLUSO' : privacyViolations ? 'RECHAZAR' : basic && specific && !probeAnalysis.violations ? 'CRITERIOS_BASICOS_CUMPLIDOS' : 'AJUSTAR',
        pending: ['E05/E09: comparación emparejada y apertura por isolate', 'E06: cronología de cinco éxitos, dos minutos sin reapertura y pico de recuperación', 'Revisión humana de privacidad, trazas y limitaciones; E11 completo antes de aceptar'],
        note: 'El resumen automático no declara aceptación de EXP-S5-01. Conserva evidencias y aplica las reglas completas del protocolo.' };
}
