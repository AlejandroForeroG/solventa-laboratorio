import { execFileSync } from 'node:child_process';
const cli = 'node_modules/wrangler/bin/wrangler.js';
for (const [folder, name] of [['backend/acquisition', 'AcquisitionEnv'], ['backend/identity', 'IdentityEnv'], ['experimentos/simulator', 'SimulatorEnv']]) {
    execFileSync(process.execPath, [cli, 'types', `${folder}/env.d.ts`, '-c', `${folder}/wrangler.jsonc`, '--env-interface', name, '--include-runtime', 'false'], { stdio: 'inherit' });
}
