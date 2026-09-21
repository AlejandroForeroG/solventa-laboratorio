import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { campaignPlan } from './plan';
import { uniform } from '../backend/shared/contracts';
const args = process.argv.slice(2);
const option = (key: string, defaultValue?: string) => { const index = args.indexOf(`--${key}`); return index < 0 ? defaultValue : args[index + 1]; };
const phase = option('phase', 'initial') as 'initial' | 'selection' | 'confirmation';
if (!['initial', 'selection', 'confirmation'].includes(phase))
    throw new Error('Fase inválida');
const deadline = Number(option('deadline', '120')) as 80 | 120 | 160;
const plan = campaignPlan(phase, deadline);
const controls = plan.filter(r => r.caseId === 'E09');
const rest = plan.filter(r => r.caseId !== 'E01' && r.caseId !== 'E09').sort((a, b) => uniform(4501, `${a.caseId}-${a.fixture}-${a.repetition}-${a.deadlineMs}-${a.latencyMs}`) - uniform(4501, `${b.caseId}-${b.fixture}-${b.repetition}-${b.deadlineMs}-${b.latencyMs}`));
const ordered = [...plan.filter(r => r.caseId === 'E01'), ...rest.flatMap(r => r.caseId === 'E05' ? [r, controls.find(c => c.repetition === r.repetition)!] : [r])];
const output = resolve('experimentos/resultados-crudos', `campaign-${phase}-${crypto.randomUUID()}`);
await mkdir(output, { recursive: true });
await writeFile(`${output}/order.json`, JSON.stringify(ordered.map(({ startAt, ...run }) => run), null, 2));
console.log(`Orden preregistrado: ${output}. ${ordered.length} corridas; Ctrl+C detiene la campaña.`);
for (const run of ordered) {
    const forwarded = ['base-url', 'runner-location', 'db-topology', 'artifact-version', 'k6'].flatMap(key => option(key) ? [`--${key}`, option(key)!] : []);
    const cliArgs = ['--import', 'tsx', 'experimentos/cli.ts', 'run', '--run-id', run.runId, '--case', run.caseId, '--fixture', run.fixture, '--deadline', String(run.deadlineMs), '--latency', String(run.latencyMs), '--repetition', String(run.repetition), '--phase', phase, ...forwarded];
    const child = spawn(process.execPath, cliArgs, { stdio: 'inherit', windowsHide: true });
    const code = await new Promise<number | null>((ok, fail) => { child.on('exit', ok); child.on('error', fail); });
    if (code !== 0)
        throw new Error('Campaña detenida por fallo del runner. Conserve la corrida y diagnostique antes de repetir.');
}
