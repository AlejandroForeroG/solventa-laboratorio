import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileProvider } from '../reconcile';
test('matching counts cannot hide mismatched request IDs or operations', () => {
    const api = [{ traceId: 'a', operation: 'quote', providerAttempt: true, providerDispatched: true }];
    for (const receipt of [{ requestId: 'b', operation: 'quote' }, { requestId: 'a', operation: 'profile' }]) {
        const result = reconcileProvider(api, [receipt]);
        assert.equal(result.reconciled, false);
        assert.equal(result.missingReceipts.length, 1);
        assert.equal(result.unexpectedReceipts.length, 1);
    }
});
test('cancellation is not a receipt; only explicit cancellation before dispatch is explained', () => {
    const base = { traceId: 'a', operation: 'quote', providerAttempt: true };
    assert.equal(reconcileProvider([{ ...base, providerDispatched: true, providerAbortAt: 10 }], []).reconciled, false);
    assert.equal(reconcileProvider([{ ...base, providerDispatched: false }], []).reconciled, false);
    const result = reconcileProvider([{ ...base, providerDispatched: false, cancelledAt: 10 }], []);
    assert.equal(result.reconciled, true);
    assert.deepEqual(result.cancelledBeforeDispatch, ['quote/a']);
});
test('duplicate receipts, missing completion and unaccounted receipts remain visible', () => {
    const api = [{ traceId: 'a', operation: 'quote', providerAttempt: true }], receipt = { requestId: 'a', operation: 'quote' };
    assert.equal(reconcileProvider(api, [receipt, receipt]).reconciled, false);
    assert.equal(reconcileProvider([], [receipt]).reconciled, false);
    assert.equal(reconcileProvider(api, [receipt]).completionReconciled, false);
    assert.equal(reconcileProvider(api, [receipt], [receipt]).completionReconciled, true);
});
