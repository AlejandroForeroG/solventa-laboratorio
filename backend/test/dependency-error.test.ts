import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseFailure, safeDatabaseFailure, parseRemoteFailure } from '../shared/dependency-error';
test('dependency diagnostics preserve a known failure stage without SQL or secrets', () => {
    const error = Object.assign(new Error('postgres://user:secret@host SQL payload'), { code: 'ECONNRESET' });
    assert.deepEqual(safeDatabaseFailure(new DatabaseFailure('connect', error)), { stage: 'connect', code: 'ECONNRESET' });
    assert.deepEqual(safeDatabaseFailure(new DatabaseFailure('query', new Error('Query read timeout'))), { stage: 'query', code: 'QUERY_TIMEOUT' });
    const clock = safeDatabaseFailure(new DatabaseFailure('query', new Error('remote wall time is too far ahead (706.817252ms) to be trustworthy')));
    assert.deepEqual(clock, { stage: 'query', code: 'CLOCK_OFFSET' });
    assert.deepEqual(parseRemoteFailure(clock), clock);
});
test('remote diagnostics reject arbitrary error fields and messages', () => {
    assert.deepEqual(parseRemoteFailure({ stage: 'postgres://secret', code: 'password', message: 'secret' }), { stage: 'unknown', code: 'UNKNOWN' });
    assert.deepEqual(parseRemoteFailure(null), { stage: 'unknown', code: 'UNKNOWN' });
    assert.deepEqual(parseRemoteFailure({ stage: 'query', code: '42501' }), { stage: 'query', code: '42501' });
});
