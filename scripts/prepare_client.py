"""Restore the packaged static assets locally, without network access or overwrites."""
import argparse
import base64
import binascii
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import tempfile
import zipfile
import zlib

MAX_ARCHIVE_BYTES = 64 * 1024 * 1024
MAX_UNPACKED_BYTES = 128 * 1024 * 1024
MAX_PART_BYTES = 16 * 1024 * 1024
MAX_MANIFEST_BYTES = 16 * 1024 * 1024
MAX_PARTS = 4096
MAX_FILES = 2000
FORMAT = 'rea-asset-archive-v1'
HEX_DIGEST = re.compile(r'[0-9a-f]{64}\Z')
WINDOWS_DEVICE = re.compile(r'(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?\Z', re.I)


class PreparationError(ValueError):
    """An archive or destination failed a local integrity check."""


def _size(value, label, limit):
    if type(value) is not int or not 0 <= value <= limit:
        raise PreparationError(f'{label}: expected an integer between 0 and {limit}')
    return value


def _digest(value, label):
    if not isinstance(value, str) or not HEX_DIGEST.fullmatch(value):
        raise PreparationError(f'{label}: expected a lowercase SHA256 digest')
    return value


def _relative(value):
    if not isinstance(value, str) or not value or '\\' in value or ':' in value:
        raise PreparationError(f'Unsafe archive path: {value!r}')
    parts = value.split('/')
    if any(not part or part in ('.', '..') or part[-1:] in ('.', ' ') or
           any(ord(char) < 32 or char in '<>"|?*' for char in part) or
           WINDOWS_DEVICE.fullmatch(part) for part in parts):
        raise PreparationError(f'Unsafe archive path: {value!r}')
    path = PurePosixPath(value)
    if path.is_absolute() or path.as_posix() != value:
        raise PreparationError(f'Unsafe archive path: {value!r}')
    return path


def _plain_chain(path):
    """Use lstat before resolve: reject symlinks and Windows junction/reparse points."""
    for item in reversed((path, *path.parents)):
        try:
            metadata = item.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(metadata.st_mode) or getattr(metadata, 'st_file_attributes', 0) & 0x400:
            raise PreparationError(f'Links/reparse points are not allowed: {item}')
        if item != path and not stat.S_ISDIR(metadata.st_mode):
            raise PreparationError(f'Parent is not a directory: {item}')


def _regular_file(path):
    _plain_chain(path)
    try:
        metadata = path.lstat()
    except FileNotFoundError:
        raise PreparationError(f'Missing archive file: {path}') from None
    if not stat.S_ISREG(metadata.st_mode):
        raise PreparationError(f'Expected a regular file: {path}')
    return metadata


def _file_digest(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(block)
    return result.hexdigest()


def _load_manifest(path):
    if _regular_file(path).st_size > MAX_MANIFEST_BYTES:
        raise PreparationError('Manifest exceeds the size limit')
    try:
        manifest = json.loads(path.read_text(encoding='utf-8'))
    except (UnicodeError, json.JSONDecodeError) as error:
        raise PreparationError(f'Invalid asset manifest: {error}') from error
    if not isinstance(manifest, dict) or manifest.get('format') != FORMAT:
        raise PreparationError(f'Unsupported asset manifest format; expected {FORMAT}')
    if manifest.get('encoding') != 'base64-chunks':
        raise PreparationError('Unsupported asset encoding; expected base64-chunks')
    archive = manifest.get('archive')
    if not isinstance(archive, dict):
        raise PreparationError('Missing archive metadata')
    _size(archive.get('size'), 'archive.size', MAX_ARCHIVE_BYTES)
    _digest(archive.get('sha256'), 'archive.sha256')
    unpacked_limit = _size(archive.get('max_unpacked_bytes'), 'archive.max_unpacked_bytes', MAX_UNPACKED_BYTES)
    files = manifest.get('files')
    parts = manifest.get('parts')
    if not isinstance(files, list) or not 0 < len(files) <= MAX_FILES:
        raise PreparationError('Invalid asset file count')
    if not isinstance(parts, list) or not 0 < len(parts) <= MAX_PARTS:
        raise PreparationError('Invalid archive part count')
    for entries, label, size_limit in ((parts, 'parts', MAX_PART_BYTES), (files, 'files', MAX_UNPACKED_BYTES)):
        identities = set()
        for entry in entries:
            if not isinstance(entry, dict):
                raise PreparationError(f'Invalid {label} entry')
            _relative(entry.get('path'))
            identity = entry['path'].casefold()
            if identity in identities:
                raise PreparationError(f'Duplicate {label} path: {entry["path"]}')
            identities.add(identity)
            _size(entry.get('size'), f'{label}.size', size_limit)
            _digest(entry.get('sha256'), f'{label}.sha256')
        if label == 'files':
            for identity in identities:
                parents = PurePosixPath(identity).parents
                if any(parent.as_posix() in identities for parent in parents):
                    raise PreparationError(f'Asset file/directory collision: {identity}')
    if sum(entry['size'] for entry in files) > unpacked_limit:
        raise PreparationError('Manifest expanded size exceeds its declared limit')
    return manifest


def _restore_archive(manifest, source, output):
    count = 0
    digest = hashlib.sha256()
    with output.open('xb') as stream:
        for entry in manifest['parts']:
            path = source.joinpath(*_relative(entry['path']).parts)
            if _regular_file(path).st_size != entry['size']:
                raise PreparationError(f'Archive part size mismatch: {entry["path"]}')
            encoded = path.read_bytes()
            if hashlib.sha256(encoded).hexdigest() != entry['sha256']:
                raise PreparationError(f'Archive part SHA256 mismatch: {entry["path"]}')
            try:
                encoded.decode('ascii')
                decoded = base64.b64decode(encoded, validate=True)
            except (UnicodeError, binascii.Error) as error:
                raise PreparationError(f'Invalid ASCII base64 part: {entry["path"]}') from error
            if base64.b64encode(decoded) != encoded:
                raise PreparationError(f'Non-canonical base64 part: {entry["path"]}')
            count += len(decoded)
            if count > manifest['archive']['size'] or count > MAX_ARCHIVE_BYTES:
                raise PreparationError('Decoded ZIP exceeds the declared size limit')
            digest.update(decoded)
            stream.write(decoded)
    if count != manifest['archive']['size'] or digest.hexdigest() != manifest['archive']['sha256']:
        raise PreparationError('ZIP size or SHA256 mismatch')


def _stage_members(manifest, archive_path, stage):
    expected = {entry['path']: entry for entry in manifest['files']}
    try:
        with zipfile.ZipFile(archive_path) as archive:
            members = archive.infolist()
            identities = set()
            for member in members:
                if member.orig_filename != member.filename:
                    raise PreparationError(f'Unsafe archive path: {member.orig_filename!r}')
                _relative(member.filename)
                mode = member.external_attr >> 16
                if (member.is_dir() or member.external_attr & 0x410 or
                        stat.S_IFMT(mode) not in (0, stat.S_IFREG) or member.flag_bits & 1):
                    raise PreparationError(f'ZIP member must be an unencrypted regular file: {member.filename}')
                if member.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                    raise PreparationError(f'Unsupported ZIP compression: {member.filename}')
                identity = member.filename.casefold()
                if identity in identities:
                    raise PreparationError(f'Duplicate ZIP member: {member.filename}')
                identities.add(identity)
                entry = expected.get(member.filename)
                if entry is None or member.file_size != entry['size']:
                    raise PreparationError(f'Unexpected ZIP member or size: {member.filename}')
            if {member.filename for member in members} != set(expected):
                raise PreparationError('ZIP members do not match the exact manifest allowlist')
            expanded = 0
            for index, member in enumerate(members):
                entry = expected[member.filename]
                digest = hashlib.sha256()
                written = 0
                target = stage / str(index)
                with archive.open(member) as reader, target.open('xb') as writer:
                    for block in iter(lambda: reader.read(1024 * 1024), b''):
                        written += len(block)
                        expanded += len(block)
                        if written > entry['size'] or expanded > manifest['archive']['max_unpacked_bytes']:
                            raise PreparationError('Expanded ZIP exceeds the declared size limit')
                        digest.update(block)
                        writer.write(block)
                if written != entry['size'] or digest.hexdigest() != entry['sha256']:
                    raise PreparationError(f'Asset size or SHA256 mismatch: {member.filename}')
                entry['_staged'] = target
    except (zipfile.BadZipFile, RuntimeError, EOFError, NotImplementedError, zlib.error) as error:
        raise PreparationError(f'Invalid asset ZIP: {error}') from error


def _destinations(manifest, root):
    pending = []
    for entry in manifest['files']:
        target = root.joinpath(*_relative(entry['path']).parts)
        _plain_chain(target)
        try:
            metadata = target.lstat()
        except FileNotFoundError:
            pending.append((entry, target))
            continue
        if not stat.S_ISREG(metadata.st_mode):
            raise PreparationError(f'Asset destination is not a regular file: {entry["path"]}')
        if metadata.st_size != entry['size'] or _file_digest(target) != entry['sha256']:
            raise PreparationError(f'Existing asset differs; refusing to overwrite: {entry["path"]}')
    return pending


def prepare_client(repo_root=None, manifest_path=None):
    """Validate every part/member first, then add only missing matching assets.

    Returns counts. Existing correct assets are retained; conflicts fail before any
    asset is written. The manifest, packed sources, and unrelated files are unchanged.
    """
    repo = Path(os.path.abspath(repo_root or Path(__file__).parent.parent))
    source = Path(os.path.abspath(manifest_path or repo / 'asset-archive' / 'manifest.json'))
    _plain_chain(repo)
    manifest = _load_manifest(source)
    destination = repo / 'offline_web'
    _plain_chain(destination)
    with tempfile.TemporaryDirectory(prefix='.rea-prepare-', dir=repo) as temporary:
        stage = Path(temporary)
        archive_path = stage / 'assets.zip'
        _restore_archive(manifest, source.parent, archive_path)
        _stage_members(manifest, archive_path, stage)
        pending = _destinations(manifest, destination)
        created = []
        try:
            for entry, target in pending:
                _plain_chain(target)
                target.parent.mkdir(parents=True, exist_ok=True)
                _plain_chain(target)
                with target.open('xb') as writer:
                    created.append(target)
                    with entry['_staged'].open('rb') as reader:
                        shutil.copyfileobj(reader, writer)
        except BaseException:
            for target in reversed(created):
                _plain_chain(target)
                target.unlink()
            raise
    return {'restored': len(pending), 'verified': len(manifest['files']),
            'skipped': len(manifest['files']) - len(pending)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, help='Repository root (defaults to this script\'s parent)')
    parser.add_argument('--manifest', type=Path, help='Alternative local asset manifest')
    args = parser.parse_args()
    try:
        print(json.dumps(prepare_client(args.root, args.manifest)))
    except (PreparationError, OSError) as error:
        parser.exit(1, f'Asset preparation failed: {error}\n')


if __name__ == '__main__':
    main()
