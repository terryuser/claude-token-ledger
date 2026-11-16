"""Build the uploadable package: dist/token-ledger-<version>.plugin.

The package is a zip holding one `token-ledger/` folder with exactly one
`.claude-plugin/plugin.json`, as Claude's Customize > Plugins upload expects.
Tests, local notes and the type declarations Claude Code generates are left out.

    python scripts/pack.py
"""
import json
import os
import zipfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PLUGIN = os.path.join(REPO, 'token-ledger')
DIST = os.path.join(REPO, 'dist')
SKIP_DIRS = {'tests', 'node_modules'}
SKIP_ROOT_FILES = {'PROGRESS.md', 'tsconfig.json'}


def posix(path: str) -> str:
    return path.replace(os.sep, '/')


def main() -> None:
    with open(os.path.join(PLUGIN, '.claude-plugin', 'plugin.json'), encoding='utf-8') as manifest:
        version = json.load(manifest)['version']
    os.makedirs(DIST, exist_ok=True)
    out = os.path.join(DIST, f'token-ledger-{version}.plugin')

    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as archive:
        for folder, dirs, files in os.walk(PLUGIN):
            rel = posix(os.path.relpath(folder, PLUGIN))
            dirs[:] = [d for d in dirs if d not in SKIP_DIRS and not (rel == '.claude-plugin' and d == 'types')]
            for name in files:
                if rel == '.' and name in SKIP_ROOT_FILES:
                    continue
                path = os.path.join(folder, name)
                archive.write(path, 'token-ledger/' + posix(os.path.relpath(path, PLUGIN)))

    names = zipfile.ZipFile(out).namelist()
    manifests = sum(n.endswith('.claude-plugin/plugin.json') for n in names)
    if manifests != 1:
        raise SystemExit(f'expected one plugin.json, found {manifests}')
    print(f'{out} ({len(names)} files, {os.path.getsize(out)} bytes)')


if __name__ == '__main__':
    main()
