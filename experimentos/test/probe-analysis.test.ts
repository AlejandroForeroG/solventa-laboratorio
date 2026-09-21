import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeProbes } from '../probe-analysis';
const row = (at: number, startedAt = at, phase = 'measured', operation = 'quote', instanceId = 'a') => ({
    traceId: String(at), instanceId, operation, phase, probe: true, startedAt, breakerEvents: [{ event: 'probe', at }]
});
test('consent delay must not turn the allowed 30 s admission boundary into a violation', () => {
    const result = analyzeProbes([row(30000, 29900), row(0), row(1)]);
    assert.equal(result.violations, 0);
    assert.deepEqual(result.missingEvidence, []);
    assert.equal(analyzeProbes([row(29999), row(0), row(1)]).violations, 1);
});
test('checks warmup overlap without combining operations or instances', () => {
    assert.equal(analyzeProbes([row(0, 0, 'warmup'), row(1), row(29999)]).violations, 1);
    assert.equal(analyzeProbes([row(0), row(1, 1, 'measured', 'profile'), row(2, 2, 'measured', 'quote', 'b')]).violations, 0);
});
test('missing admission evidence is explicit, never replaced by request start', () => {
    const missing = { ...row(0), breakerEvents: [] };
    assert.deepEqual(analyzeProbes([missing]).missingEvidence, ['a/quote']);
    assert.deepEqual(analyzeProbes([row(NaN)]).missingEvidence, ['quote/NaN']);
});
test('concurrent responses can carry circuit events for another request in the same group', () => {
    const drained = { ...row(1), probe: false };
    const admitted = { ...row(1), traceId: 'other', breakerEvents: [] };
    assert.deepEqual(analyzeProbes([drained, admitted]).missingEvidence, []);
});
