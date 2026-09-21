import { appendFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { z } from 'zod';
const pageSchema = z.array(z.object({ seq: z.number().int().positive(), kind: z.string(), body: z.string() }));
const statsSchema = z.array(z.object({ kind: z.string(), n: z.number().int().nonnegative() }));
type FetchJson = (path: string) => Promise<unknown>;
export async function exportRunEvidence(directory: string, runId: string, fetchJson: FetchJson) {
    const target = `${directory}/exports/${new Date().toISOString().replace(/[:.]/g, '-')}`;
    await mkdir(target, { recursive: true });
    const audit: {
        path: string;
        attempt: number;
        ok: boolean;
    }[] = [];
    const read = async (path: string) => {
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const value = await fetchJson(path);
                audit.push({ path, attempt, ok: true });
                return value;
            }
            catch (error) {
                audit.push({ path, attempt, ok: false });
                if (attempt === 3)
                    throw error;
                await new Promise(resolve => setTimeout(resolve, 250 * attempt));
            }
        }
        throw new Error('export_read_failed');
    };
    const events: z.infer<typeof pageSchema> = [];
    let after = 0;
    try {
        const before = statsSchema.parse(await read(`/bank/stats/${runId}`));
        while (true) {
            const page = pageSchema.parse(await read(`/bank/evidence/${runId}?after=${after}`));
            if (!page.length)
                break;
            for (const event of page) {
                if (event.seq <= after)
                    throw new Error('export_sequence_not_increasing');
                after = event.seq;
            }
            await appendFile(`${target}/pages.jsonl`, page.map(event => JSON.stringify(event)).join('\n') + '\n');
            events.push(...page);
        }
        const afterStats = statsSchema.parse(await read(`/bank/stats/${runId}`));
        const counts = Object.fromEntries(afterStats.map(x => [x.kind, x.n]));
        const actual: Record<string, number> = {};
        for (const e of events)
            actual[e.kind] = (actual[e.kind] ?? 0) + 1;
        const consistent = [...new Set([...Object.keys(counts), ...Object.keys(actual)])].every(k => (counts[k] ?? 0) === (actual[k] ?? 0));
        await writeFile(`${target}/server-events.json`, JSON.stringify(events));
        await writeFile(`${target}/server-stats.json`, JSON.stringify(afterStats, null, 2));
        await writeFile(`${target}/verification.json`, JSON.stringify({ runId, before, after: afterStats, exported: actual, consistent }, null, 2));
        if (!consistent)
            throw new Error(`export_counts_changed_or_incomplete: ${target}`);
        for (const file of ['server-events.json', 'server-stats.json']) {
            await copyFile(`${target}/${file}`, `${directory}/${file}`, constants.COPYFILE_EXCL).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'EEXIST')
                throw error; });
        }
        return { count: events.length, directory: target };
    }
    finally {
        await writeFile(`${target}/requests.json`, JSON.stringify(audit, null, 2));
    }
}
