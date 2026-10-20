"""Read-only provenance verification. No network requests or game execution."""
from pathlib import Path, PurePosixPath
import hashlib
import json

ROOT = Path(__file__).resolve().parent.parent
MAIN = 'assets/main-rEMKAGlg-mvgfxz8a.js'
MODIFIED = {'index.html', MAIN}

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def checked_file(root, relative):
    path = PurePosixPath(relative)
    if not relative or path.is_absolute() or '..' in path.parts or '\\' in relative or ':' in relative:
        raise ValueError(f'Unsafe manifest path: {relative}')
    target = root.joinpath(*path.parts).resolve()
    if not target.is_relative_to(root.resolve()) or not target.is_file():
        raise ValueError(f'Missing or escaped file: {relative}')
    return target

def main():
    manifest = json.loads((ROOT/'provenance/asset-manifest.json').read_text(encoding='utf-8'))
    build = json.loads((ROOT/'provenance/build-record.json').read_text(encoding='utf-8'))
    expected = set()
    total = 0
    for entry in manifest['resources']:
        relative = entry['path']
        if relative in expected:
            raise ValueError(f'Duplicate source identity: {relative}')
        expected.add(relative)
        root = ROOT/'provenance/original' if relative in MODIFIED else ROOT/'offline_web'
        path = checked_file(root, relative)
        if path.stat().st_size != entry['bytes'] or digest(path) != entry['sha256']:
            raise ValueError(f'Source mismatch: {relative}')
        total += entry['bytes']
    checks = {
        ROOT/'provenance/original'/MAIN: build['source_main_sha256'],
        ROOT/'offline_web'/MAIN: build['derived_main_sha256'],
        ROOT/'offline_web/index.html': build['derived_index_sha256'],
        ROOT/'offline_web/offline-adapter.js': build['adapter_sha256'],
        ROOT/'offline-adapter.js': build['adapter_sha256'],
    }
    for path, expected_digest in checks.items():
        if digest(path) != expected_digest:
            raise ValueError(f'Derived mismatch: {path.relative_to(ROOT)}')
    actual = {p.relative_to(ROOT/'offline_web').as_posix() for p in (ROOT/'offline_web').rglob('*') if p.is_file()}
    if actual != expected | {'offline-adapter.js'}:
        raise ValueError('Unexpected or missing offline client files')
    print(json.dumps({'original_files': len(expected), 'original_bytes': total, 'source_hashes_match': True, 'derived_hashes_match': True, 'offline_file_set_matches': True}))

if __name__ == '__main__':
    main()
