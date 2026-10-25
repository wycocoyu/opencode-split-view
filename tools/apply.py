#!/usr/bin/env python3
import argparse
from pathlib import Path
import shutil
import subprocess

BASELINE = 'a517687fde98a7329ada3ae644a01a9fc6c4e99e'
ROOT = Path(__file__).resolve().parent.parent


def apply(target):
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=target, text=True).strip()
    if head != BASELINE:
        raise SystemExit('Target must be at the documented OpenCode 2.1.2 baseline')
    if subprocess.check_output(['git', 'status', '--porcelain'], cwd=target, text=True).strip():
        raise SystemExit('Target checkout must be clean')
    patch = ROOT / 'patches/tracked.patch'
    subprocess.run(['git', 'apply', '--check', str(patch)], cwd=target, check=True)
    changed = set(subprocess.check_output(['git', 'apply', '--numstat', str(patch)], text=True).splitlines())
    tracked = {line.split('\t', 2)[2] for line in changed}
    additions = [file for file in (ROOT / 'source').rglob('*')
                 if file.is_file() and file.relative_to(ROOT / 'source').as_posix() not in tracked]
    for file in additions:
        destination = target / file.relative_to(ROOT / 'source')
        if destination.exists():
            raise SystemExit(f'Refusing to overwrite existing file: {destination}')
    subprocess.run(['git', 'apply', str(patch)], cwd=target, check=True)
    for file in additions:
        destination = target / file.relative_to(ROOT / 'source')
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(file, destination)
    print('Applied tracked patch and added', len(additions), 'new source files')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('checkout', type=Path)
    apply(parser.parse_args().checkout.resolve())
