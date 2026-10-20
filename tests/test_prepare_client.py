"""Self-generated ZIP/base64 samples only; no game assets are read or executed."""
import base64
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest import mock
import zipfile

REPO = Path(__file__).resolve().parent.parent
SPEC = importlib.util.spec_from_file_location('prepare_client', REPO / 'scripts' / 'prepare_client.py')
prepare = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(prepare)


def sha(data):
    return hashlib.sha256(data).hexdigest()


class PrepareClientTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='.test-prepare-', dir=REPO)
        self.root = Path(self.temporary.name)
        self.archive = self.root / 'asset-archive'
        self.archive.mkdir()
        self.manifest_path = self.archive / 'manifest.json'
        self.files = {'assets/sample.bin': b'\x00\xffself-generated\x01', 'data/rules.json': b'{"sample":true}'}
        self.manifest = self.pack()

    def tearDown(self):
        self.temporary.cleanup()

    def save(self):
        self.manifest_path.write_text(json.dumps(self.manifest), encoding='utf-8')

    def pack(self, members=None, transform=None):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            for name, data in (members if members is not None else self.files.items()):
                archive.writestr(name, data)
        packed = buffer.getvalue()
        if transform is not None:
            packed = transform(packed)
        parts = []
        for number, offset in enumerate(range(0, len(packed), 31)):
            encoded = base64.b64encode(packed[offset:offset + 31])
            name = f'part-{number:03d}.b64'
            (self.archive / name).write_bytes(encoded)
            parts.append({'path': name, 'size': len(encoded), 'sha256': sha(encoded)})
        manifest = {'format': prepare.FORMAT, 'encoding': 'base64-chunks',
                    'archive': {'size': len(packed), 'sha256': sha(packed),
                                'max_unpacked_bytes': sum(map(len, self.files.values()))},
                    'parts': parts,
                    'files': [{'path': name, 'size': len(data), 'sha256': sha(data)}
                              for name, data in self.files.items()]}
        self.manifest = manifest
        self.save()
        return manifest

    def change_part(self, content):
        entry = self.manifest['parts'][0]
        (self.archive / entry['path']).write_bytes(content)
        entry.update(size=len(content), sha256=sha(content))
        self.save()

    def rejected(self, message):
        with self.assertRaisesRegex(prepare.PreparationError, message):
            prepare.prepare_client(self.root)
        self.assertFalse(list(self.root.glob('.rea-prepare-*')))

    def test_restores_all_and_second_run_skips_without_modifying_files(self):
        result = prepare.prepare_client(self.root)
        self.assertEqual(result, {'restored': 2, 'verified': 2, 'skipped': 0})
        for name, data in self.files.items():
            self.assertEqual((self.root / 'offline_web' / name).read_bytes(), data)
        timestamps = {name: (self.root / 'offline_web' / name).stat().st_mtime_ns for name in self.files}
        self.assertEqual(prepare.prepare_client(self.root), {'restored': 0, 'verified': 2, 'skipped': 2})
        self.assertEqual(timestamps, {name: (self.root / 'offline_web' / name).stat().st_mtime_ns for name in self.files})

    def test_conflict_checks_all_files_before_writing_any(self):
        target = self.root / 'offline_web' / 'data/rules.json'
        target.parent.mkdir(parents=True)
        target.write_bytes(b'local changes')
        self.rejected('refusing to overwrite')
        self.assertEqual(target.read_bytes(), b'local changes')
        self.assertFalse((self.root / 'offline_web/assets/sample.bin').exists())

    def test_preserves_unrelated_local_files(self):
        local = self.root / 'offline_web' / 'index.html'
        local.parent.mkdir()
        local.write_text('self-generated local client', encoding='utf-8')
        prepare.prepare_client(self.root)
        self.assertEqual(local.read_text(), 'self-generated local client')

    def test_part_size_and_hash_are_checked(self):
        entry = self.manifest['parts'][0]
        (self.archive / entry['path']).write_bytes(b'A' * entry['size'])
        self.rejected('part SHA256 mismatch')
        (self.archive / entry['path']).write_bytes(b'A')
        self.rejected('part size mismatch')

    def test_non_ascii_and_invalid_base64_are_rejected(self):
        for content in (b'\xff\xff\xff\xff', b'!!!!', b'YQ==\n', b'YR=='):
            with self.subTest(content=content):
                self.change_part(content)
                self.rejected('base64')

    def test_whole_archive_hash_is_checked(self):
        self.manifest['archive']['sha256'] = '0' * 64
        self.save()
        self.rejected('ZIP size or SHA256 mismatch')

    def test_member_hash_is_checked_before_any_destination_write(self):
        self.manifest['files'][-1]['sha256'] = '0' * 64
        self.save()
        self.rejected('Asset size or SHA256 mismatch')
        self.assertFalse((self.root / 'offline_web').exists())

    def test_exact_allowlist_rejects_unexpected_or_missing_member(self):
        self.pack([*self.files.items(), ('other.bin', b'not allowed')])
        self.rejected('Unexpected ZIP member')
        self.pack([next(iter(self.files.items()))])
        self.rejected('exact manifest allowlist')

    def test_member_size_must_match_manifest(self):
        self.manifest['files'][0]['size'] -= 1
        self.save()
        self.rejected('Unexpected ZIP member or size')

    def test_duplicate_zip_names_are_rejected_case_insensitively(self):
        first, data = next(iter(self.files.items()))
        self.files[first.upper()] = data
        self.pack()
        # Keep a valid manifest: the unexpected second member still duplicates its ZIP identity.
        self.manifest['files'] = self.manifest['files'][:-1]
        self.save()
        self.rejected('Duplicate ZIP member')

    def test_duplicate_manifest_paths_are_rejected(self):
        self.manifest['files'].append(dict(self.manifest['files'][0]))
        self.save()
        self.rejected('Duplicate files path')

    def test_file_directory_manifest_collision_is_rejected(self):
        self.manifest['files'].append({'path': 'assets', 'size': 0, 'sha256': sha(b'')})
        self.save()
        self.rejected('file/directory collision')

    def test_unsafe_manifest_paths_are_rejected(self):
        for path in ('../escape', '/absolute', 'C:/escape', 'a\\b', './name', 'a//b',
                     'trailing.', 'a/CON.txt', 'name:stream', 'a\x00b'):
            with self.subTest(path=path):
                self.manifest['files'][0]['path'] = path
                self.save()
                self.rejected('Unsafe archive path')

    def test_unsafe_zip_path_is_rejected_even_when_not_allowlisted(self):
        self.pack([*self.files.items(), ('../escape', b'unsafe')])
        self.rejected('Unsafe archive path')
        self.assertFalse((self.root / 'escape').exists())

    def test_zip_null_name_cannot_hide_behind_python_name_normalization(self):
        self.pack([('assets/sample.binX', self.files['assets/sample.bin']),
                   ('data/rules.json', self.files['data/rules.json'])],
                  transform=lambda data: data.replace(b'assets/sample.binX', b'assets/sample.bin\x00'))
        self.rejected('Unsafe archive path')

    def test_directory_and_symlink_zip_members_are_rejected(self):
        self.pack([*self.files.items(), ('directory/', b'')])
        self.rejected('Unsafe archive path|regular file')
        info = zipfile.ZipInfo('assets/sample.bin')
        info.create_system = 3
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        self.pack([(info, self.files['assets/sample.bin']), ('data/rules.json', self.files['data/rules.json'])])
        self.rejected('regular file')

    def test_expanded_and_archive_limits_are_enforced(self):
        self.manifest['archive']['max_unpacked_bytes'] = 1
        self.save()
        self.rejected('expanded size exceeds')
        self.manifest['archive']['size'] = prepare.MAX_ARCHIVE_BYTES + 1
        self.save()
        self.rejected('archive.size')

    def test_symlink_destination_is_rejected(self):
        web = self.root / 'offline_web'
        web.mkdir()
        other = self.root / 'other'
        other.mkdir()
        try:
            os.symlink(other, web / 'assets', target_is_directory=True)
        except (OSError, NotImplementedError) as error:
            self.skipTest(f'Host does not permit creating a sample symlink: {error}')
        self.rejected('Links/reparse points')
        self.assertFalse(list(other.iterdir()))

    def test_reparse_destination_is_rejected(self):
        web = self.root / 'offline_web'
        web.mkdir()
        real_lstat = Path.lstat

        def marked_lstat(path, *args, **kwargs):
            metadata = real_lstat(path, *args, **kwargs)
            if path == web:
                return type('SampleReparse', (), {'st_mode': metadata.st_mode, 'st_file_attributes': 0x400})()
            return metadata

        with mock.patch.object(Path, 'lstat', marked_lstat):
            self.rejected('Links/reparse points')

    def test_part_symlink_is_rejected(self):
        entry = self.manifest['parts'][0]
        part = self.archive / entry['path']
        other = self.root / 'original-part'
        part.rename(other)
        try:
            os.symlink(other, part)
        except (OSError, NotImplementedError) as error:
            self.skipTest(f'Host does not permit creating a sample symlink: {error}')
        self.rejected('Links/reparse points')

    def test_cli_restores_sample_without_executing_client(self):
        result = subprocess.run([sys.executable, str(REPO / 'scripts/prepare_client.py'), '--root', str(self.root)],
                                capture_output=True, text=True, check=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['restored'], 2)


if __name__ == '__main__':
    unittest.main()
