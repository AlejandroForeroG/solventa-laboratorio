import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const manifest = JSON.parse(await readFile(resolve(root, 'resultados/manifest.json'), 'utf8'));
let emitted = 0, complete = 0, passed = 0;
const rows = [];
for (const run of manifest.runs) {
    const a = JSON.parse(await readFile(resolve(root, 'resultados/corridas', run.runId, 'analysis.json'), 'utf8'));
    for (const [op, value] of Object.entries(a.results)) {
        const r = value as {
            emitted: number;
            complete: number;
            p95: number;
            p99: number;
            latencyPass: boolean;
            completenessPass: boolean;
        };
        emitted += r.emitted;
        complete += r.complete;
        const pass = r.latencyPass && r.completenessPass;
        passed += Number(pass);
        rows.push({ escenario: run.caseId, repetición: run.repetition, condición: a.caseId === 'E07' ? JSON.parse(await readFile(resolve(root, 'resultados/corridas', run.runId, 'run.json'), 'utf8')).run.fixture : '', operación: op, p95: r.p95, p99: r.p99, latencia_y_completitud: pass ? 'Pasa' : 'No pasa' });
    }
}
console.table(rows);
console.log(`${manifest.runs.length} corridas; ${emitted} emitidas; ${complete} completas; ${emitted - complete} no completas.`);
console.log(`Latencia y completitud: ${passed}/${rows.length} resultados pasan. Otros criterios se explican en docs/resultados.md.`);
