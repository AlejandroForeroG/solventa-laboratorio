from pathlib import Path
import hashlib
import json
import sys
import zipfile

root = Path(__file__).resolve().parents[1]
archives = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else root / 'descargas'
target = root / '.replay'
target.mkdir(exist_ok=True)
manifest = json.loads((root / 'resultados/manifest.json').read_text(encoding='utf-8'))
for run in manifest['runs']:
    path = archives / run['archive']
    with path.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != run['archiveSha256']:
            raise ValueError(f'Hash inválido: {path.name}')
    with zipfile.ZipFile(path) as archive:
        for item in archive.infolist():
            dest = (target / item.filename).resolve()
            if not dest.is_relative_to(target.resolve()): raise ValueError('Ruta inválida en ZIP')
        archive.extractall(target)
    print(f'Extraída y verificada: {run["runId"]}', flush=True)
