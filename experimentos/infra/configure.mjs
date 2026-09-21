import { readFile, writeFile } from 'node:fs/promises';
const target = process.argv[2];
if (!['local-sql', 'staging'].includes(target))
    throw new Error('Uso: node experimentos/infra/configure.mjs local-sql|staging [riskHyperdriveId] [consentHyperdriveId]');
if (target === 'staging' && !process.argv.slice(3, 5).every(v => /^[a-f0-9]{32}$/.test(v)) || target === 'staging' && process.argv.length !== 5)
    throw new Error('Se requieren los dos IDs reales de Hyperdrive');
if (target === 'staging' && !/^[a-f0-9]{32}$/.test(process.env.CLOUDFLARE_ACCOUNT_ID ?? ''))
    throw new Error('Declare CLOUDFLARE_ACCOUNT_ID de la cuenta autorizada');
for (const [folder, index] of [['backend/acquisition', 3], ['backend/identity', 4], ['experimentos/simulator', 0]]) {
    const config = JSON.parse(await readFile(`${folder}/wrangler.jsonc`, 'utf8'));
    if (config.vars)
        config.vars.BANK_MODE = target === 'staging' ? 'staging-sql' : 'local-sql';
    if (target === 'staging') {
        config.account_id = process.env.CLOUDFLARE_ACCOUNT_ID;
        config.name += '-staging';
        for (const binding of config.services ?? [])
            binding.service += '-staging';
        if (config.hyperdrive) {
            config.hyperdrive[0].id = process.argv[index];
            delete config.hyperdrive[0].localConnectionString;
        }
        if (folder === 'backend/acquisition')
            config.workers_dev = true;
    }
    await writeFile(`${folder}/wrangler.${target}.jsonc`, JSON.stringify(config, null, 2) + '\n');
}
console.log(`Configuraciones ${target} creadas. No se desplegaron recursos.`);
