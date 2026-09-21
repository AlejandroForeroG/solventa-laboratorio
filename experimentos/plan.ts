import { runSchema, type Run } from '../backend/shared/contracts';
export function makeRun(caseId: Run['caseId'], options: Partial<Run> = {}): Run {
    const fixture = caseId === 'E07' ? 'expired' : caseId === 'E08' ? 'revoked' : 'valid';
    return runSchema.parse({ runId: `${caseId}-${crypto.randomUUID()}`, caseId, phase: caseId === 'E10' ? 'selection' : 'initial', repetition: 1,
        fixture, deadlineMs: 120, breakerEnabled: caseId !== 'E09', bulkhead: 64, latencyMs: caseId === 'E02' ? 100 : caseId === 'E03' ? 300 : 40,
        errorRate: ['E05', 'E07', 'E08', 'E09'].includes(caseId) ? 1 : caseId === 'E04' ? 0.3 : 0, seed: 4501,
        startAt: Date.now() + 15000, warmupMs: 120000, conditioningMs: caseId === 'E06' ? 60000 : 0, measuredMs: 300000,
        fixtureNow: Date.UTC(2026, 8, 9, 12), ...options });
}
export function campaignPlan(phase: 'initial' | 'selection' | 'confirmation', deadline: 80 | 120 | 160 = 120): Run[] {
    const cases: Run['caseId'][] = phase === 'selection' ? ['E10'] : phase === 'confirmation' ? ['E01', 'E03', 'E04', 'E05', 'E06', 'E07', 'E08', 'E09'] : ['E01', 'E02', 'E03', 'E04', 'E05', 'E06', 'E07', 'E08', 'E09'];
    const output: Run[] = [];
    for (const caseId of cases)
        for (const fixture of caseId === 'E07' ? ['expired', 'absent'] as const : [caseId === 'E08' ? 'revoked' : 'valid'] as const)
            for (const d of caseId === 'E10' ? [80, 120, 160] as const : [deadline])
                for (const latency of caseId === 'E10' ? [100, 150] : [undefined])
                    for (let repetition = 1; repetition <= 3; repetition++)
                        output.push(makeRun(caseId, { phase, fixture, deadlineMs: d, repetition, ...(latency === undefined ? {} : { latencyMs: latency }) }));
    return output;
}
