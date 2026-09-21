import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportRunEvidence } from '../export-evidence';
test('export retries reads, preserves the original capture and verifies counts', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'solventa-export-'));
    let failures = 0;
    await writeFile(`${dir}/server-events.json`, 'preserved');
    const result = await exportRunEvidence(dir, 'test', async (path) => {
        if (path.includes('/stats/'))
            return [{ kind: 'api', n: 1 }];
        if (path.endsWith('after=0')) {
            if (failures++ === 0)
                throw Error('transient');
            return [{ seq: 1, kind: 'api', body: '{}' }];
        }
        return [];
    });
    assert.equal(result.count, 1);
    assert.equal(await readFile(`${dir}/server-events.json`, 'utf8'), 'preserved');
    const audit = JSON.parse(await readFile(`${result.directory}/requests.json`, 'utf8'));
    assert.equal(audit.filter((x: {
        ok: boolean;
    }) => !x.ok).length, 1);
});
test('incomplete export is retained but never published as a complete capture', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'solventa-export-'));
    await assert.rejects(exportRunEvidence(dir, 'test', async (path) => path.includes('/stats/') ? [{ kind: 'api', n: 2 }] : path.endsWith('after=0') ? [{ seq: 1, kind: 'api', body: '{}' }] : []), /export_counts_changed_or_incomplete/);
    await assert.rejects(readFile(`${dir}/server-events.json`), { code: 'ENOENT' });
});
