import { deliverEvidence, evidenceFailure } from '../../backend/shared/evidence-delivery';
import { requestTrace } from '../../backend/shared/request-trace';
import { Hono } from 'hono';
import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import { authorized } from '../../backend/shared/security';
import { untilAborted } from '../../backend/shared/deadline';
import { requestSchema, operationSchema, providerCondition, uniform, phaseAt, runSchema } from '../../backend/shared/contracts';
export class Evidence extends DurableObject<SimulatorEnv> {
    constructor(ctx: DurableObjectState, env: SimulatorEnv) {
        super(ctx, env);
        this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, body TEXT NOT NULL)');
        this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS evidence_keys (event_id TEXT PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL)');
        this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS manifest (id INTEGER PRIMARY KEY, body TEXT NOT NULL)');
    }
    async register(body: string) {
        const existing = this.ctx.storage.sql.exec<{
            body: string;
        }>('SELECT body FROM manifest WHERE id=1').toArray();
        if (existing.length)
            throw new Error('run_id_already_used');
        this.ctx.storage.sql.exec('INSERT INTO manifest VALUES (1,?)', body);
        await this.ctx.storage.setAlarm(Date.now() + 7 * 86400000);
        return { registered: true };
    }
    record(kind: string, body: string, eventId?: string) {
        this.ctx.storage.transactionSync(() => {
            if (eventId) {
                const old = this.ctx.storage.sql.exec<{
                    kind: string;
                    body: string;
                }>('SELECT kind,body FROM evidence_keys WHERE event_id=?', eventId).toArray()[0];
                if (old) {
                    if (old.kind !== kind || old.body !== body)
                        throw new Error('evidence_key_conflict');
                    return;
                }
                this.ctx.storage.sql.exec('INSERT INTO evidence_keys VALUES (?,?,?)', eventId, kind, body);
            }
            this.ctx.storage.sql.exec('INSERT INTO events(kind,body) VALUES (?,?)', kind, body);
        });
    }
    export(after: number) {
        return this.ctx.storage.sql.exec<{
            seq: number;
            kind: string;
            body: string;
        }>('SELECT seq,kind,body FROM events WHERE seq>? ORDER BY seq LIMIT 1000', after).toArray();
    }
    stats() {
        return this.ctx.storage.sql.exec<{
            kind: string;
            n: number;
        }>('SELECT kind,COUNT(*) AS n FROM events GROUP BY kind').toArray();
    }
    async alarm() { await this.ctx.storage.deleteAll(); }
}
const app = new Hono<{
    Bindings: SimulatorEnv;
}>();
app.use('*', async (c, next) => {
    if (!authorized(c.req.header('authorization'), c.env.BANK_TOKEN))
        return c.json({ error: 'unauthorized' }, 401);
    await next();
});
app.use('*', requestTrace('simulator'));
app.post('/register', async (c) => {
    const run = runSchema.parse(await c.req.json());
    return c.json(await c.env.EVIDENCE.getByName(run.runId).register(JSON.stringify(run)));
});
const eventSchema = z.object({ runId: runSchema.shape.runId, kind: z.enum(['api', 'isolate']), eventId: z.string().max(250).optional(), event: z.record(z.string(), z.unknown()) });
app.post('/record', async (c) => {
    const payload = eventSchema.parse(await c.req.json());
    try {
        await c.env.EVIDENCE.getByName(payload.runId).record(payload.kind, JSON.stringify(payload.event), payload.eventId);
    }
    catch (error) {
        const diagnostic = evidenceFailure(error);
        console.error(JSON.stringify({ kind: 'evidence_error', runId: payload.runId, traceId: payload.event.traceId, eventKind: payload.kind, stage: 'durable_record', diagnostic, at: Date.now() }));
        return c.json({ error: 'evidence_write_failed', diagnostic }, 503);
    }
    return c.json({ recorded: true });
});
app.get('/export/:runId', async (c) => {
    const runId = runSchema.shape.runId.parse(c.req.param('runId'));
    const after = z.coerce.number().int().min(0).parse(c.req.query('after') ?? 0);
    return c.json(await c.env.EVIDENCE.getByName(runId).export(after));
});
app.get('/stats/:runId', async (c) => c.json(await c.env.EVIDENCE.getByName(runSchema.shape.runId.parse(c.req.param('runId'))).stats()));
app.post('/provider/:operation', async (c) => {
    const { run, requestId } = requestSchema.parse(await c.req.json());
    const operation = operationSchema.parse(c.req.param('operation'));
    const receivedAt = Date.now(), condition = providerCondition(run, receivedAt);
    const latency = Math.max(0, condition.latencyMs + (uniform(run.seed, requestId + 'jitter') * 2 - 1) * run.jitterMs);
    const fail = uniform(run.seed, requestId) < condition.errorRate;
    const event = { requestId, operation, instanceId: c.req.header('x-instance-id'), receivedAt, phase: phaseAt(run, receivedAt), latencyMs: latency, failed: fail };
    c.executionCtx.waitUntil(deliverEvidence(() => c.env.EVIDENCE.getByName(run.runId).record('provider', JSON.stringify(event), 'provider/' + operation + '/' + requestId), { runId: run.runId, traceId: requestId, operation, eventKind: 'provider', stage: 'durable_record' }));
    console.log(JSON.stringify({ kind: 'provider', runId: run.runId, ...event }));
    const work = (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        let outcome = 'completed';
        try {
            await untilAborted(new Promise<void>(resolve => { timer = setTimeout(resolve, latency); }), c.req.raw.signal);
            if (fail) {
                outcome = 'injected_failure';
                return c.json({ error: 'injected_failure' }, 503);
            }
            if (run.invalidPayload) {
                outcome = 'invalid_payload';
                return c.json({ invalid: true });
            }
            return c.json({ version: '1', score: 70, source: 'open-finance', observedAt: run.fixtureNow, validUntil: run.fixtureNow + 60000, consentRef: `synthetic-${run.fixture}` });
        }
        catch (error) {
            outcome = c.req.raw.signal.aborted ? 'cancelled' : 'error';
            throw error;
        }
        finally {
            if (timer !== undefined)
                clearTimeout(timer);
            const end = { requestId, operation, instanceId: event.instanceId, receivedAt, finishedAt: Date.now(), outcome, requestSignalAborted: c.req.raw.signal.aborted };
            c.executionCtx.waitUntil(deliverEvidence(() => c.env.EVIDENCE.getByName(run.runId).record('provider_end', JSON.stringify(end), 'provider_end/' + operation + '/' + requestId), { runId: run.runId, traceId: requestId, operation, eventKind: 'provider_end', stage: 'durable_record' }));
            console.log(JSON.stringify({ kind: 'provider_end', runId: run.runId, ...end }));
        }
    })();
    c.executionCtx.waitUntil(work.then(() => { }, () => { }));
    return work;
});
app.onError((_e, c) => c.json({ error: 'simulator_error' }, 500));
export default app;
