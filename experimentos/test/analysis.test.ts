import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wilson, percentile } from '../analyze';
import { campaignPlan } from '../plan';
test('Wilson does not pass an insufficient zero-failure sample', () => {
    assert.equal(wilson(0, 0), null);
    assert.ok(wilson(3837, 3837)! < .999);
    assert.ok(wilson(3838, 3838)! >= .999);
    assert.ok(wilson(9000, 10000)! < .999);
});
test('percentiles interpolate without aggregating repetitions', () => {
    assert.equal(percentile([], .95), null);
    assert.equal(percentile([100, 0], .95), 95);
});
test('campaign explicitly splits E07 and keeps E09 in confirmation', () => {
    assert.equal(campaignPlan('initial').length, 30);
    assert.equal(campaignPlan('selection').length, 18);
    const confirmation = campaignPlan('confirmation', 160);
    assert.equal(confirmation.length, 27);
    assert.equal(confirmation.filter(r => r.caseId === 'E09' && !r.breakerEnabled && r.deadlineMs === 160).length, 3);
    assert.equal(confirmation.filter(r => r.caseId === 'E07' && r.fixture === 'absent').length, 3);
});
