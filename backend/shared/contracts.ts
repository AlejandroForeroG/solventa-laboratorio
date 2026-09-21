import { z } from 'zod';
export const operationSchema = z.enum(['quote', 'profile']);
export type Operation = z.infer<typeof operationSchema>;
export const fixtureSchema = z.enum(['valid', 'expired', 'absent', 'revoked']);
export type Fixture = z.infer<typeof fixtureSchema>;
export const runSchema = z.object({
    runId: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/),
    caseId: z.enum(['E01', 'E02', 'E03', 'E04', 'E05', 'E06', 'E07', 'E08', 'E09', 'E10']),
    phase: z.enum(['initial', 'selection', 'confirmation', 'diagnostic']),
    repetition: z.number().int().min(1).max(3),
    fixture: fixtureSchema,
    deadlineMs: z.union([z.literal(80), z.literal(120), z.literal(160)]),
    breakerEnabled: z.boolean(),
    bulkhead: z.number().int().min(1).max(1000),
    latencyMs: z.number().int().min(0).max(2000),
    errorRate: z.number().min(0).max(1),
    jitterMs: z.number().int().min(0).max(500).default(0),
    invalidPayload: z.boolean().default(false),
    sqlReadRetry: z.boolean().optional(),
    sqlReadFault: z.enum(['first', 'all']).optional(),
    snapshotFailureDegrade: z.boolean().optional(),
    snapshotReadFault: z.boolean().optional(),
    seed: z.number().int().nonnegative(),
    startAt: z.number().int().positive(),
    warmupMs: z.number().int().min(0),
    conditioningMs: z.number().int().min(0),
    measuredMs: z.number().int().min(1000).max(600000),
    fixtureNow: z.number().int().positive(),
}).strict();
export type Run = z.infer<typeof runSchema>;
export const requestSchema = z.object({
    run: runSchema,
    requestId: z.string().regex(/^[a-zA-Z0-9_-]{1,150}$/),
    emittedAt: z.number().int().positive(),
}).strict();
export const signalsSchema = z.object({
    version: z.literal('1'), score: z.number().int().min(0).max(100),
    observedAt: z.number().int(), validUntil: z.number().int(),
    consentRef: z.string(), source: z.enum(['open-finance', 'snapshot']),
}).strict();
export type Signals = z.infer<typeof signalsSchema>;
export interface Consent {
    allowed: boolean;
    reference: string;
    checkedAt: number;
}
export type Classification = 'normal' | 'degraded' | 'denied' | 'technical_error';
export interface Decision {
    classification: Classification;
    reason: string;
    definitiveOffer: boolean;
    source: Signals['source'] | null;
    ageMs: number | null;
    validUntil: number | null;
    score?: number;
    premiumCop?: number;
}
export function measuredStart(run: Run) { return run.startAt + run.warmupMs + run.conditioningMs; }
export function phaseAt(run: Run, now: number) {
    if (now < run.startAt)
        return 'pending';
    if (now < run.startAt + run.warmupMs)
        return 'warmup';
    if (now < measuredStart(run))
        return 'conditioning';
    return now < measuredStart(run) + run.measuredMs ? 'measured' : 'finished';
}
export function providerCondition(run: Run, now: number) {
    const phase = phaseAt(run, now);
    if (['E05', 'E09'].includes(run.caseId) && phase === 'warmup')
        return { latencyMs: 40, errorRate: 0 };
    if (run.caseId === 'E06')
        return { latencyMs: 40, errorRate: phase === 'conditioning' ? 1 : 0 };
    return { latencyMs: run.latencyMs, errorRate: run.errorRate };
}
export function uniform(seed: number, id: string) {
    let hash = (2166136261 ^ seed) >>> 0;
    for (const char of id)
        hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
    return hash / 4294967296;
}
