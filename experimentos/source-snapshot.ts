import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
export async function snapshotSource(root: string, directory: string) {
    const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '--', 'backend', 'experimentos', 'package.json', 'package-lock.json', 'tsconfig.json', 'tools/bank-types.mjs', 'tools/install-k6.mjs'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean).sort();
    const manifest: {
        file: string;
        sha256: string;
    }[] = [];
    for (const file of new Set(files)) {
        if (/\.dev\.vars|\.local\.json|resultados-crudos|\.env/.test(file))
            continue;
        const bytes = await readFile(resolve(root, file));
        const target = resolve(directory, 'source', file);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, bytes);
        manifest.push({ file, sha256: createHash('sha256').update(bytes).digest('hex') });
    }
    await writeFile(`${directory}/source-manifest.json`, JSON.stringify(manifest, null, 2));
    return createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
}
