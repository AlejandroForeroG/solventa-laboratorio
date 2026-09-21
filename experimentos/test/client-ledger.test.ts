import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileClient } from '../client-ledger';
const emitted = (id: string, phase = 'measured') => ({ kind: 'client_emitted' as const, requestId: id, operation: 'quote' as const, phase, at: 1 });
const response = (id: string, classification = 'degraded', phase = 'measured') => ({ ...emitted(id, phase), kind: 'client_response' as const, classification, at: 2 });
const server = (id: string, phase = 'measured') => ({ traceId: id, operation: 'quote', phase, classification: 'degraded' });
test('client/server identity mismatch cannot pass just because counts match', () => {
    const result = reconcileClient([emitted('a'), response('a')], [server('b')]);
    assert.equal(result.reconciled, false);
    assert.deepEqual(result.phases.measured.missingApi, ['quote/a']);
    assert.deepEqual(result.phases.measured.unexpectedApi, ['quote/b']);
});
test('records client timeout alongside actual server success without changing either observation', () => {
    const result = reconcileClient([emitted('a'), response('a', 'technical_error')], [server('a')]);
    assert.equal(result.reconciled, true);
    assert.deepEqual(result.phases.measured.differences, ['quote/a']);
});
test('missing response, duplicate emission and warmup loss stay visible', () => {
    const result = reconcileClient([emitted('a'), emitted('a'), emitted('b', 'warmup'), response('b', 'degraded', 'warmup')], [server('a')]);
    assert.equal(result.reconciled, false);
    assert.deepEqual(result.phases.measured.missingResponses, ['quote/a']);
    assert.deepEqual(result.phases.measured.duplicateIds.emitted, ['quote/a']);
    assert.deepEqual(result.phases.warmup.missingApi, ['quote/b']);
});
