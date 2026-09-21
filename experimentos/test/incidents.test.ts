import { test } from 'node:test';
import assert from 'node:assert/strict';
import { incidentReport } from '../incidents';
import { correlation, requestTrace } from '../../backend/shared/request-trace';
import { Hono } from 'hono';
test('missing evidence and client timeout never become vendor attribution or success', () => {
    const result = incidentReport([{ kind: 'client_response', requestId: 'q', operation: 'quote', phase: 'warmup', classification: 'technical_error', errorCode: 1050 }], [], [], []);
    assert.equal(result.incidents[0].attribution, 'unresolved');
    assert.equal(result.incidents[0].phase, 'warmup');
    assert.equal(result.counts.missing_api_record, 1);
    const withServer = incidentReport([{ kind: 'client_response', requestId: 'q', operation: 'quote', classification: 'technical_error' }], [{ traceId: 'q', operation: 'quote', classification: 'degraded', providerDispatched: true }], [], []);
    assert.equal(withServer.counts.client_failure_with_api_record, 1);
    assert.equal(withServer.counts.missing_provider_receipt, 1);
});
test('correlation excludes credentials and malformed identifiers', () => {
    assert.deepEqual(correlation(new Headers({ 'authorization': 'secret', 'x-run-id': 'bad value', 'x-request-id': 'quote-1' })), { runId: undefined, traceId: 'quote-1', operation: undefined, cfRay: undefined });
});
test('ingress survives body parse failure and records final handler status', async () => {
    const app = new Hono();
    app.use('*', requestTrace('test'));
    app.post('/', async (c) => c.json(await c.req.json()));
    app.onError((_e, c) => c.json({ error: 'invalid' }, 400));
    const lines: string[] = [];
    const original = console.log;
    console.log = s => lines.push(s);
    try {
        const response = await app.request('https://test/', { method: 'POST', headers: { 'x-run-id': 'run-1', 'x-request-id': 'quote-1' }, body: 'invalid' });
        assert.equal(response.status, 400);
        assert.deepEqual(lines.map(s => JSON.parse(s).stage), ['ingress', 'handler_end']);
        assert.equal(JSON.parse(lines[1]).status, 400);
    }
    finally {
        console.log = original;
    }
});
