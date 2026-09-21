import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deliverEvidence, evidenceFailure } from '../shared/evidence-delivery';
test('retries transient failures and preserves the failed attempt after recovery', async () => {
    const logs: Record<string, unknown>[] = [];
    let calls = 0;
    await deliverEvidence(async () => { if (++calls === 1)
        throw Object.assign(new Error('reset'), { retryable: true }); }, {}, e => logs.push(e), async () => { });
    assert.equal(calls, 2);
    assert.deepEqual(logs.map(e => e.kind), ['evidence_error', 'evidence_recovered']);
});
test('never retries overloaded or unknown failures; caps retryable failures at three', async () => {
    for (const [error, expected] of [[Object.assign(new Error('overloaded'), { overloaded: true, retryable: true }), 1], [new Error('unknown'), 1], [Object.assign(new Error('reset'), { retryable: true }), 3]] as const) {
        let calls = 0;
        await deliverEvidence(async () => { calls++; throw error; }, {}, () => { }, async () => { });
        assert.equal(calls, expected);
    }
});
test('diagnostics exclude arbitrary messages and credentials', () => {
    assert.ok(!JSON.stringify(evidenceFailure(new Error('secret-token=abc'))).includes('secret'));
});
