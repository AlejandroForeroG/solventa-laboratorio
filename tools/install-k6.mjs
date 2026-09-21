import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
if (process.platform !== 'win32')
    throw new Error('Este instalador es para Windows x64. Instale k6 según la documentación oficial en otros sistemas.');
const version = 'v2.2.0', name = `k6-${version}-windows-amd64.zip`;
const origin = `https://github.com/grafana/k6/releases/download/${version}`;
const [archive, checksums] = await Promise.all([fetch(`${origin}/${name}`).then(async (r) => { if (!r.ok)
        throw new Error('k6 download failed'); return Buffer.from(await r.arrayBuffer()); }), fetch(`${origin}/k6-${version}-checksums.txt`).then(r => r.text())]);
const expected = checksums.split('\n').find(line => line.trim().endsWith(name))?.split(/\s+/)[0];
if (createHash('sha256').update(archive).digest('hex') !== expected)
    throw new Error('Checksum k6 inválido');
const folder = resolve('tools/k6');
await mkdir(folder, { recursive: true });
await writeFile(`${folder}/k6.zip`, archive);
execFileSync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${folder.replaceAll("'", "''")}/k6.zip' -DestinationPath '${folder.replaceAll("'", "''")}' -Force`], { stdio: 'inherit', windowsHide: true });
const { copyFile } = await import('node:fs/promises');
await copyFile(`${folder}/k6-${version}-windows-amd64/k6.exe`, `${folder}/k6.exe`);
console.log(`k6 ${version} instalado en tools/k6/k6.exe; SHA-256 comprobado.`);
