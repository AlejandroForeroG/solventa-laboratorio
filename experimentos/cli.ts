import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn, execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { randomBytes, createHash } from 'node:crypto';
import { makeRun, campaignPlan } from './plan';
import { analyze } from './analyze';
import { runSchema, type Run } from '../backend/shared/contracts';
import { z } from 'zod';
import { snapshotSource } from './source-snapshot';
import { exportRunEvidence } from './export-evidence';
import { finished } from 'node:stream/promises';
const [command, ...args] = process.argv.slice(2);
const option = (name: string, fallback?: string) => { const i = args.indexOf(`--${name}`); return i === -1 ? fallback : args[i + 1]; };
const has = (name: string) => args.includes(`--${name}`);
const root = resolve(import.meta.dirname, '..');
async function token() {
    if (process.env.BANK_TOKEN)
        return process.env.BANK_TOKEN;
    const config = JSON.parse(await readFile(resolve(root, 'experimentos/bank.local.json'), 'utf8'));
    return config.token as string;
}
async function request(base: string, path: string, secret: string, body?: unknown) {
    const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
    if (!response.ok)
        throw new Error(`Banco HTTP ${response.status}: ${path}`);
    return response.json();
}
async function exportEvidence(directory: string) {
    const config = JSON.parse(await readFile(`${directory}/run.json`, 'utf8'));
    const secret = await token();
    return exportRunEvidence(directory, config.run.runId, path => request(config.baseUrl, path, secret));
}
async function main() {
    if (command === 'init') {
        const path = resolve(root, 'experimentos/bank.local.json');
        let secret: string;
        try {
            secret = JSON.parse(await readFile(path, 'utf8')).token;
        }
        catch {
            secret = Buffer.from(randomBytes(32)).toString('hex');
            await writeFile(path, JSON.stringify({ token: secret }));
        }
        for (const directory of ['backend/acquisition', 'backend/identity', 'experimentos/simulator'])
            await writeFile(resolve(root, directory, '.dev.vars'), `BANK_TOKEN=${secret}\n`, { flag: 'wx' }).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'EEXIST')
                throw e; });
        await writeFile(resolve(root, 'experimentos/secrets.local.json'), JSON.stringify({ BANK_TOKEN: secret }), { flag: 'wx' }).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'EEXIST')
            throw e; });
        console.log('Credencial local preparada (archivos excluidos de Git).');
        return;
    }
    if (command === 'plan') {
        const phase = option('phase', 'initial') as 'initial' | 'selection' | 'confirmation';
        if (!['initial', 'selection', 'confirmation'].includes(phase))
            throw new Error('Fase inválida');
        const deadline = Number(option('deadline', '120')) as 80 | 120 | 160;
        const plan = campaignPlan(phase, deadline);
        const result = { phase, deadline, runs: plan.map(({ startAt, ...r }) => r), count: plan.length,
            minimumMinutes: plan.reduce((s, r) => s + r.warmupMs + r.conditioningMs + r.measuredMs, 0) / 60000,
            note: 'Orden listado; sortear y registrar corridas independientes después de E01. Emparejar E05/E09. E06 mantiene calentamiento, caída y recuperación.' };
        const path = resolve(option('output', `experimentos/plan-${phase}.local.json`)!);
        await writeFile(path, JSON.stringify(result, null, 2));
        console.log(`Plan: ${path}; ${plan.length} corridas.`);
        return;
    }
    if (command === 'export' || command === 'analyze') {
        const directory = resolve(option('directory') ?? '');
        if (!option('directory'))
            throw new Error('Falta --directory');
        if (command === 'export')
            console.log(JSON.stringify(await exportEvidence(directory)));
        else {
            const result = await analyze(directory, option('evidence-directory'));
            const output = option('output', `${directory}/analysis-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)!;
            await writeFile(output, JSON.stringify(result, null, 2), { flag: 'wx' });
            console.log(JSON.stringify({ output, ...result }, null, 2));
        }
        return;
    }
    if (command === 'run') {
        const diagnostic = has('diagnostic'), baseUrl = option('base-url', 'http://127.0.0.1:8787')!.replace(/\/$/, '');
        const url = new URL(baseUrl), local = ['localhost', '127.0.0.1'].includes(url.hostname);
        if (!local && url.protocol !== 'https:')
            throw new Error('El ambiente remoto debe usar HTTPS');
        if (!diagnostic && local)
            throw new Error('Local exige --diagnostic; no acredita los ASR remotos');
        if (!diagnostic && (!option('runner-location') || !option('db-topology') || !option('artifact-version')))
            throw new Error('Declare --runner-location, --db-topology y --artifact-version antes de una corrida candidata');
        if (!diagnostic && option('runner-location') !== 'Bogota-Colombia')
            throw new Error('El protocolo requiere un runner realmente ubicado en Bogotá, Colombia');
        const caseId = option('case', 'E01') as Run['caseId'];
        if (has('sql-read-retry') && !diagnostic)
            throw new Error('La mitigación SQL requiere --diagnostic hasta completar su evaluación');
        if (has('sql-read-fault') && !diagnostic)
            throw new Error('La inyección SQL requiere --diagnostic');
        if ((has('snapshot-failure-degrade') || has('snapshot-read-fault')) && !diagnostic)
            throw new Error('La política de respaldo requiere --diagnostic');
        const run = makeRun(caseId, { ...(option('fixture') ? { fixture: option('fixture') as Run['fixture'] } : {}), deadlineMs: Number(option('deadline', '120')) as Run['deadlineMs'],
            ...(option('run-id') ? { runId: option('run-id')! } : {}),
            ...(has('sql-read-retry') ? { sqlReadRetry: true } : {}),
            ...(has('sql-read-fault') ? { sqlReadFault: option('sql-read-fault') as 'first' | 'all' } : {}),
            ...(has('snapshot-failure-degrade') ? { snapshotFailureDegrade: true } : {}),
            ...(has('snapshot-read-fault') ? { snapshotReadFault: true } : {}),
            phase: diagnostic ? 'diagnostic' : option('phase', caseId === 'E10' ? 'selection' : 'initial') as Run['phase'], repetition: Number(option('repetition', '1')),
            ...(option('latency') ? { latencyMs: Number(option('latency')) } : {}),
            ...(diagnostic ? { warmupMs: Number(option('warmup', '5')) * 1000, measuredMs: Number(option('duration', '15')) * 1000 } : {}),
            startAt: Date.now() + 20000 });
        if (!diagnostic && caseId === 'E07' && !option('fixture'))
            throw new Error('E07 requiere --fixture expired o absent');
        if (!diagnostic && (caseId === 'E07' ? !['expired', 'absent'].includes(run.fixture) : run.fixture !== (caseId === 'E08' ? 'revoked' : 'valid')))
            throw new Error('El fixture no corresponde al caso preregistrado');
        if (!diagnostic && caseId === 'E10' && (![100, 150].includes(run.latencyMs) || !option('deadline')))
            throw new Error('E10 requiere --latency 100|150 y --deadline 80|120|160');
        const rate = Number(option('rate', diagnostic ? '10' : '100'));
        if (![10, 100].includes(rate) || (!diagnostic && rate !== 100))
            throw new Error('Carga admitida: 10 o 100; campaña candidata: 100');
        const k6 = option('k6', resolve(root, 'tools/k6/k6.exe'))!;
        const k6Version = execFileSync(k6, ['version'], { encoding: 'utf8' }).trim();
        const secret = await token();
        const samples = [];
        for (let i = 0; i < 5; i++) {
            const pingStart = Date.now();
            const health = z.object({ service: z.string(), mode: z.string(), serverNow: z.number(), capabilities: z.array(z.string()).optional() }).parse(await request(baseUrl, '/health', secret));
            const pingEnd = Date.now();
            if (health.service !== 'solventa-experimental-bank')
                throw new Error('El destino no es el banco experimental');
            if (!diagnostic && health.mode !== 'staging-sql')
                throw new Error('Una corrida candidata requiere staging-sql');
            samples.push({ pingStart, pingEnd, health, roundTripMs: pingEnd - pingStart, estimatedClockOffsetMs: health.serverNow - (pingStart + pingEnd) / 2 });
        }
        const selected = samples.reduce((best, sample) => sample.roundTripMs < best.roundTripMs ? sample : best);
        const { health } = selected;
        if (has('sql-read-retry') && !health.capabilities?.includes('sql-read-recovery-v2'))
            throw new Error('El destino aún no anuncia la versión requerida de recuperación SQL');
        if (has('snapshot-failure-degrade') && !health.capabilities?.includes('snapshot-failure-degrade-v1'))
            throw new Error('El destino aún no anuncia la política de respaldo requerida');
        const networkBaseline = { roundTripMs: selected.roundTripMs, estimatedClockOffsetMs: selected.estimatedClockOffsetMs, selection: 'minimum-rtt-of-5', samples };
        if ((!diagnostic || has('require-clock')) && Math.abs(networkBaseline.estimatedClockOffsetMs) > 100)
            throw new Error('Sincronice el reloj: diferencia estimada >100 ms; registre RTT y vuelva a comprobar');
        if (health.service !== 'solventa-experimental-bank')
            throw new Error('El destino no es el banco experimental');
        if (!diagnostic && health.mode !== 'staging-sql')
            throw new Error('Una corrida candidata requiere staging-sql');
        const outputRoot = resolve(root, 'experimentos/resultados-crudos');
        await mkdir(outputRoot, { recursive: true });
        const directory = resolve(outputRoot, run.runId);
        await mkdir(directory);
        const sourceStatus = execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' });
        const sourceHash = await snapshotSource(root, directory);
        const manifest = { run, baseUrl, diagnostic, rate, sourceHash, clientLedgerVersion: 1, clockGuardEnforced: !diagnostic || has('require-clock'), networkBaseline, node: process.version, k6: k6Version, commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(), sourceStatus,
            runnerLocation: option('runner-location', 'no_verificada'), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, dbTopology: option('db-topology', health.mode), artifactVersion: option('artifact-version', 'working-tree'),
            protocol: 'EXP-S5-01, Drive 2026-09-07', bulkheadStatus: '64 por isolate/operación; parámetro de montaje, eficacia pendiente', recoveryRateWindowMs: 10000 };
        await writeFile(`${directory}/run.json`, JSON.stringify(manifest, null, 2));
        await writeFile(`${directory}/preparation.json`, JSON.stringify(await request(baseUrl, '/bank/prepare', secret, run), null, 2));
        const stdout = createWriteStream(`${directory}/k6-console.log`);
        const child = spawn(k6, ['run', '--log-format', 'json', '--console-output', `${directory}/client-events.jsonl`, '--out', `json=${directory}/k6-raw.jsonl`, resolve(root, 'experimentos/k6/bank.js')], { cwd: root, env: { ...process.env, BANK_TOKEN: secret, RUN_FILE: `${directory}/run.json`, SUMMARY_FILE: `${directory}/k6-summary.json` }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
        child.stdout.pipe(stdout, { end: false });
        child.stderr.pipe(stdout, { end: false });
        console.log(`Ejecutando ${run.caseId}: ${directory}`);
        const code = await new Promise<number | null>((ok, fail) => { child.on('close', ok); child.on('error', fail); });
        stdout.end();
        await finished(stdout);
        await writeFile(`${directory}/exit-code.txt`, String(code));
        await new Promise(resolve => setTimeout(resolve, 3000));
        await exportEvidence(directory);
        const analysis = await analyze(directory);
        await writeFile(`${directory}/analysis.json`, JSON.stringify(analysis, null, 2));
        console.log(`${analysis.status}. Resultados: ${directory}`);
        if (code !== 0 || !analysis.valid)
            process.exitCode = 1;
        return;
    }
    console.log('Comandos: init | plan --phase initial|selection|confirmation | run --case E01 [--diagnostic] | export --directory RUTA | analyze --directory RUTA');
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'bank_failed'); process.exitCode = 1; });
