import { requestTrace } from '../shared/request-trace';
import { Hono } from 'hono';
import { authorized } from '../shared/security';
import { runSchema } from '../shared/contracts';
import { consentFixture } from '../shared/fixtures';
import { withDatabase, withDatabaseRead, type DatabaseTimings } from '../shared/database';
import { RetryBudget } from '../shared/read-recovery';
import { uniform } from '../shared/contracts';
import { safeDatabaseFailure } from '../shared/dependency-error';
const app = new Hono<{
    Bindings: IdentityEnv;
}>();
const localConsents = new Map<string, {
    allowed: boolean;
    reference: string;
    expires: number;
}>();
const readRetryBudget = new RetryBudget();
app.use('*', async (c, next) => {
    if (!authorized(c.req.header('authorization'), c.env.BANK_TOKEN))
        return c.json({ error: 'unauthorized' }, 401);
    await next();
});
app.use('*', requestTrace('identity'));
app.post('/consent/check', async (c) => {
    const run = runSchema.parse(await c.req.json());
    if (c.env.BANK_MODE === 'local-memory') {
        const consent = localConsents.get(run.runId);
        if (!consent)
            throw new Error('fixture_not_seeded');
        return c.json({ allowed: consent.allowed, reference: consent.reference, checkedAt: run.fixtureNow });
    }
    const traceId = c.req.header('x-request-id');
    const deadline = Number(c.req.header('x-hard-deadline-at'));
    const controller = new AbortController();
    const timer = traceId ? setTimeout(() => controller.abort(new Error('hard_deadline')), Math.max(0, Math.min(700, deadline - Date.now()))) : undefined;
    const timing: DatabaseTimings = { stage: 'connect', startedAt: Date.now() };
    const signal = AbortSignal.any([controller.signal, c.req.raw.signal]);
    const recovery = run.phase === 'diagnostic' && run.sqlReadRetry && traceId ? { signal, deadlineAt: deadline, firstAttemptMs: 200, retryDelayMs: 10 + Math.floor(uniform(run.seed, traceId + 'consent-retry') * 16), takeRetry: () => readRetryBudget.take() } : undefined;
    const work = withDatabaseRead(c.env.CONSENT_DB.connectionString, async (db, attempt) => {
        if (traceId && run.phase === 'diagnostic' && (run.sqlReadFault === 'all' || run.sqlReadFault === 'first' && attempt === 1)) {
            console.log(JSON.stringify({ kind: 'fault_injection', dependency: 'consent', runId: run.runId, traceId, attempt, fault: 'sql_sleep_1s' }));
            await db.query('SELECT pg_sleep(1)');
        }
        const result = await db.query('SELECT allowed, reference FROM identity_exp.consents WHERE run_id=$1', [run.runId]);
        if (!result.rows[0])
            throw new Error('fixture_not_seeded');
        return { allowed: result.rows[0].allowed === true, reference: String(result.rows[0].reference), checkedAt: run.fixtureNow };
    }, { timings: timing, signal, onProgress: t => {
            console.log(JSON.stringify({ kind: 'database', dependency: 'consent', runId: run.runId, traceId, operation: c.req.header('x-operation'), ...t }));
        } }, recovery);
    c.executionCtx.waitUntil(work.then(() => { }, () => { }));
    try {
        return c.json({ ...await work, databaseTiming: timing });
    }
    catch (error) {
        return c.json({ error: 'consent_store_error', diagnostic: safeDatabaseFailure(error), databaseTiming: timing }, 500);
    }
    finally {
        if (timer !== undefined)
            clearTimeout(timer);
    }
});
app.post('/consent/seed', async (c) => {
    const run = runSchema.parse(await c.req.json());
    const consent = { ...consentFixture(run), allowed: true };
    if (c.env.BANK_MODE === 'local-memory') {
        for (const [id, item] of localConsents)
            if (item.expires < Date.now())
                localConsents.delete(id);
        if (localConsents.has(run.runId) || localConsents.size >= 32)
            throw new Error('run_exists_or_capacity');
        localConsents.set(run.runId, { ...consent, expires: run.startAt + run.warmupMs + run.conditioningMs + run.measuredMs + 60000 });
    }
    if (c.env.BANK_MODE !== 'local-memory')
        await withDatabase(c.env.CONSENT_DB.connectionString, async (db) => {
            await db.query('INSERT INTO identity_exp.consents(run_id,reference,allowed,confirmed_at) VALUES($1,$2,$3,$4)', [run.runId, consent.reference, consent.allowed, new Date().toISOString()]);
        });
    return c.json({ ...consent, persisted: c.env.BANK_MODE !== 'local-memory' });
});
app.post('/consent/revoke', async (c) => {
    const run = runSchema.parse(await c.req.json());
    if (c.env.BANK_MODE === 'local-memory') {
        const consent = localConsents.get(run.runId);
        if (!consent)
            throw new Error('fixture_not_seeded');
        consent.allowed = false;
    }
    else
        await withDatabase(c.env.CONSENT_DB.connectionString, async (db) => {
            const updated = await db.query('UPDATE identity_exp.consents SET allowed=false,confirmed_at=$2 WHERE run_id=$1 RETURNING run_id', [run.runId, new Date().toISOString()]);
            if (updated.rowCount !== 1)
                throw new Error('fixture_not_seeded');
        });
    return c.json({ revoked: true, runId: run.runId, confirmedAt: Date.now() });
});
app.onError((error, c) => c.json({ error: 'consent_store_error', diagnostic: safeDatabaseFailure(error) }, 500));
export default app;
