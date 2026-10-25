#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import struct
import subprocess
from copy import deepcopy

ROOT = Path(__file__).resolve().parent
APP = Path('/Applications/OpenCode.app')


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def header(path):
    with path.open('rb') as stream:
        sizes = struct.unpack('<4I', stream.read(16))
        raw = stream.read(sizes[3])
    return json.loads(raw), hashlib.sha256(raw).hexdigest()


def entries(node, prefix=''):
    for name, item in node.get('files', {}).items():
        path = prefix + name
        if 'files' in item:
            yield from entries(item, path + '/')
        else:
            yield path, item


def baseline():
    backup = Path((ROOT / 'current-backup.txt').read_text().strip())
    return backup, json.loads((backup / 'manifest.json').read_text())


def prepare(renderer):
    backup, manifest = baseline()
    if not renderer.joinpath('index.html').is_file():
        raise SystemExit('Renderer build has no index.html')
    original = backup / 'Resources/app.asar'
    if digest(original) != manifest['asar_sha256']:
        raise SystemExit('Backup ASAR hash mismatch')
    old_tree = header(original)[0]
    tree = deepcopy(old_tree)
    with original.open('rb') as stream:
        sizes = struct.unpack('<4I', stream.read(16))
        stream.seek(8 + sizes[1])
        payload = stream.read()
    offset = len(payload)
    additions = []
    for path in sorted(renderer.rglob('*')):
        if not path.is_file() or path.suffix == '.map':
            continue
        parts = ('out/renderer/' + path.relative_to(renderer).as_posix()).split('/')
        directory = tree
        for part in parts[:-1]:
            directory = directory['files'].setdefault(part, {'files': {}})
        content = path.read_bytes()
        block_size = 4 * 1024 * 1024
        directory['files'][parts[-1]] = {
            'size': len(content), 'offset': str(offset),
            'integrity': {
                'algorithm': 'SHA256', 'hash': hashlib.sha256(content).hexdigest(),
                'blockSize': block_size,
                'blocks': [hashlib.sha256(content[i:i + block_size]).hexdigest()
                           for i in range(0, len(content), block_size)],
            },
        }
        additions.append(content)
        offset += len(content)
    raw = json.dumps(tree, ensure_ascii=False, separators=(',', ':')).encode()
    padding = (4 - (len(raw) + 4) % 4) % 4
    encoded = struct.pack('<II', len(raw) + 4 + padding, len(raw)) + raw + bytes(padding)
    packed = ROOT / 'patched-app.asar'
    # Keep old payload offsets intact for the running Electron process's cached archive header.
    with packed.open('wb') as stream:
        stream.write(struct.pack('<II', 4, len(encoded)))
        stream.write(encoded)
        stream.write(payload)
        for content in additions:
            stream.write(content)
    old = dict(entries(old_tree))
    new = dict(entries(header(packed)[0]))
    for path, item in old.items():
        if path.startswith('out/renderer/'):
            continue
        other = new.get(path, {})
        for key in ['size', 'offset', 'unpacked', 'executable', 'link']:
            if item.get(key) != other.get(key):
                raise SystemExit(f'Non-renderer metadata changed: {path}: {key}')
        if item.get('integrity', {}).get('hash') != other.get('integrity', {}).get('hash'):
            raise SystemExit(f'Non-renderer content changed: {path}')
    data = {'source_asar_sha256': manifest['asar_sha256'],
            'patched_asar_sha256': digest(packed),
            'header_sha256': header(packed)[1],
            'renderer_build': str(renderer.resolve()),
            'original_payload_bytes_preserved': len(payload),
            'verified_non_renderer_files': sum(not p.startswith('out/renderer/') for p in old)}
    (ROOT / 'patch-manifest.json').write_text(json.dumps(data, indent=2) + '\n')
    print(json.dumps(data, indent=2))


def install():
    _, manifest = baseline()
    patch = json.loads((ROOT / 'patch-manifest.json').read_text())
    target = APP / 'Contents/Resources/app.asar'
    if digest(target) != manifest['asar_sha256']:
        raise SystemExit('Installed application changed since backup. Refusing to overwrite it.')
    source = ROOT / 'patched-app.asar'
    if digest(source) != patch['patched_asar_sha256']:
        raise SystemExit('Prepared ASAR hash mismatch')
    info = APP / 'Contents/Info.plist'
    data = plistlib.loads(info.read_bytes())
    if data.get('CFBundleShortVersionString') != '2.1.2':
        raise SystemExit('This patch only supports Desktop 2.1.2')
    temporary = target.with_name('app.session-sidebar-new.asar')
    shutil.copy2(source, temporary)
    os.replace(temporary, target)
    data['ElectronAsarIntegrity']['Resources/app.asar']['hash'] = patch['header_sha256']
    info.write_bytes(plistlib.dumps(data, sort_keys=False))
    subprocess.run(['codesign', '--force', '--sign', '-', str(APP)], check=True)
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(APP)], check=True)
    print('Installed renderer patch. The application and background service were not restarted.')


def restore():
    backup, manifest = baseline()
    target = APP / 'Contents/Resources/app.asar'
    patch = json.loads((ROOT / 'patch-manifest.json').read_text())
    if digest(target) not in [manifest['asar_sha256'], patch['patched_asar_sha256']]:
        raise SystemExit('Installed application has other changes. Refusing automatic restore.')
    temporary = target.with_name('app.session-sidebar-restore.asar')
    shutil.copy2(backup / 'Resources/app.asar', temporary)
    os.replace(temporary, target)
    shutil.copy2(backup / 'Info.plist', APP / 'Contents/Info.plist')
    shutil.copytree(backup / '_CodeSignature', APP / 'Contents/_CodeSignature', dirs_exist_ok=True)
    subprocess.run(['codesign', '--force', '--sign', '-', str(APP)], check=True)
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(APP)], check=True)
    if digest(target) != manifest['asar_sha256']:
        raise SystemExit('Restored ASAR hash mismatch')
    print('Restored backed-up application resources and renewed the local ad-hoc signature.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['prepare', 'install', 'restore'])
    parser.add_argument('--renderer', type=Path)
    args = parser.parse_args()
    if args.command == 'prepare':
        if args.renderer is None:
            parser.error('prepare requires --renderer')
        prepare(args.renderer)
    elif args.command == 'install':
        install()
    else:
        restore()
