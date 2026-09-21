import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, copyFile, writeFile } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { analyze } from '../experimentos/analyze';
const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(resolve(root, 'resultados/manifest.json'), 'utf8'));
const args = process.argv.slice(2);
const all = args.includes('--all');
const selected = all ? manifest.runs : manifest.runs.filter((r: {
    runId: string;
}) => r.runId === manifest.sampleRunId);
const directoryIndex = args.indexOf('--directory');
const directory = directoryIndex < 0 ? resolve(root, '.replay') : resolve(args[directoryIndex + 1]);
async function sha(path: string) {
    const digest = createHash('sha256');
    for await (const chunk of createReadStream(path))
        digest.update(chunk);
    return digest.digest('hex');
}
console.log('Reproducción local de registros existentes. Sin solicitudes al banco.');
for (const run of selected) {
    const target = resolve(directory, run.runId);
    await mkdir(target, { recursive: true });
    if (!all) {
        for (const name of ['run.json', 'analysis.json']) {
            await copyFile(resolve(root, 'resultados/corridas', run.runId, name), resolve(target, name));
        }
        for (const name of ['k6-raw.jsonl', 'server-events.json', 'client-events.jsonl']) {
            await pipeline(createReadStream(resolve(root, 'resultados/demo', name + '.gz')), createGunzip(), createWriteStream(resolve(target, name)));
        }
    }
    for (const name of ['run.json', 'analysis.json', 'k6-raw.jsonl', 'server-events.json', 'client-events.jsonl']) {
        assert.equal(await sha(resolve(target, name)), run.files[name], `Integridad: ${run.runId}/${name}`);
    }
    const original = JSON.parse(await readFile(resolve(target, 'analysis.json'), 'utf8'));
    const result = await analyze(target);
    assert.deepEqual(result.results, original.results, 'Las métricas recalculadas deben coincidir con las originales');
    assert.equal(result.valid, original.valid, 'La integridad histórica debe conservarse');
    const output = resolve(target, 'reproduccion.json');
    await writeFile(output, JSON.stringify(result, null, 2) + '\n');
    console.log(`\n${run.caseId}, repetición ${run.repetition}: ${run.runId}`);
    console.table(Object.entries(result.results).map(([operation, r]) => ({
        operación: operation === 'quote' ? 'Cotización' : 'Perfilamiento',
        emitidas: r.emitted,
        completas: r.complete,
        p95_ms: Number(r.p95?.toFixed(2)),
        p99_ms: Number(r.p99?.toFixed(2)),
        Wilson_porcentaje: Number(((r.wilsonLower ?? 0) * 100).toFixed(4)),
        latencia: r.latencyPass ? 'Pasa' : 'No pasa',
        completitud: r.completenessPass ? 'Pasa' : 'No pasa'
    })));
    console.log(`Estado automático original: ${original.status}; recalculado: ${result.status}`);
    console.log(`Sondeos fuera de intervalo: ${original.probeViolations} original; ${result.probeViolations} corregido`);
    console.log(`Hashes y métricas coinciden. Resultado: ${output}`);
}
console.log(`\nReproducción terminada: ${selected.length} corrida(s).`);
