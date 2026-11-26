"""Portable canvas packages. Only local filesystem operations; no network or dependency install."""
import json
import os
import re
import shutil
import sqlite3
import stat
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

CAPTURE = re.compile(r'(?:map|previews|audit)\.json|frame-\d+(?:\.png|-(?:desktop|tablet|phone)(?:-hug)?(?:-2x)?\.webp)')
FRAME_ID = re.compile(r'[a-z0-9][a-z0-9_-]{0,127}', re.I | re.ASCII)
OMIT = {'.git', 'node_modules', '.cache', '.vite', 'vite-cache', '__pycache__', '.ds_store',
        '.npmrc', '.pypirc', '.netrc', '.ssh', '.aws', '.gnupg', '.env', 'credentials.json',
        'credentials', 'secrets.json', 'secrets', 'id_rsa', 'id_ed25519', '.docker', 'paired-helper.local.json'}
SENSITIVE = re.compile(rb'-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----|'
                       rb'(?:AKIA|ASIA)[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9]{36,}|'
                       rb'github_pat_[A-Za-z0-9_]{60,}|sk_live_[a-zA-Z0-9]{20,}')
MAX_ENTRIES = 100000
MAX_BYTES = 4 * 1024 ** 3

def read_json(path):
    return json.loads(path.read_bytes())

def excluded(path):
    return any(p.lower() in OMIT or p.lower().startswith('.env.') or
               p.lower().endswith(('.pem', '.key', '.p12', '.pfx', '.keystore'))
               for p in path.parts)

def safe_name(name):
    rel = PurePosixPath(name)
    if (not rel.parts or rel.is_absolute() or '..' in rel.parts or str(rel) != name
            or '\\' in name or ':' in name or '\x00' in name):
        raise ValueError('Invalid file path in package')
    return rel

def write_file(z, file, name):
    safe_name(name)
    if file.is_symlink() or not file.is_file():
        raise ValueError('Expected a regular file: ' + str(file))
    # Reject recognizable credentials even when stored under an ordinary filename.
    tail = b''
    with file.open('rb') as src, z.open(name, 'w') as dest:
        while chunk := src.read(1024 * 1024):
            if SENSITIVE.search(tail + chunk):
                raise ValueError('Possible credential in ' + str(file))
            dest.write(chunk)
            tail = chunk[-160:]

def copy_tree(z, root, dest, source=False):
    if root.is_symlink() or not root.is_dir():
        raise ValueError('Expected a directory: ' + str(root))
    if source and (root / '.git').exists():
        listing = subprocess.check_output(['git', '-C', str(root), 'ls-files', '-z', '--cached', '--others', '--exclude-standard'])
        for name in sorted(set(os.fsdecode(p) for p in listing.split(b'\0') if p)):
            rel = safe_name(name)
            if excluded(rel):
                continue
            file = root / rel
            if file.is_symlink() or not file.resolve().is_relative_to(root):
                raise ValueError('Source link cannot be packaged: ' + name)
            if file.exists():
                write_file(z, file, dest + '/' + name)
        return
    for base, dirs, files in os.walk(root):
        base = Path(base)
        dirs[:] = sorted(d for d in dirs if not excluded(Path(d)) and
                         not (source and d in ('dist', 'build', 'coverage', '.next', '.turbo')))
        if any((base / d).is_symlink() for d in dirs):
            raise ValueError('Directory links cannot be packaged: ' + str(base))
        for name in sorted(files):
            if not excluded(Path(name)):
                file = base / name
                write_file(z, file, dest + '/' + file.relative_to(root).as_posix())

def add_source(z, canvas, folder):
    ref = folder / 'source.json'
    if not ref.exists():
        return
    source = (canvas / read_json(ref)['path']).resolve(strict=True)
    preview = folder / 'preview'
    if source.is_relative_to(preview):
        ref_path = source.relative_to(canvas).as_posix()
    else:
        # Inspector proposal metadata carries machine-local paths. The editable app is in app/.
        if source.is_dir() and (source / 'proposal.json').is_file() and (source / 'app').is_dir():
            source = (source / 'app').resolve()
        ref_path = 'sources/' + folder.name
        if source.is_file():
            if excluded(Path(source.name)):
                raise ValueError('Sensitive source file is excluded')
            ref_path += '/' + source.name
            write_file(z, source, ref_path)
        else:
            copy_tree(z, source, ref_path, source=True)
    z.writestr('variants/' + folder.name + '/source.json', json.dumps({'path': ref_path}))

def frame_stores(folder, frame):
    if 'steps' not in frame:
        return [(frame['id'], frame, folder)]
    steps = frame['steps']
    if not isinstance(steps, list) or not steps:
        raise ValueError('Expected an ordered list of flow steps')
    stores = []
    keys = set()
    for step in steps:
        key = step['key']
        if not FRAME_ID.fullmatch(key) or key.lower() in keys:
            raise ValueError('Invalid or duplicate flow step')
        keys.add(key.lower())
        stores.append((frame['id'] + '~' + key, step, folder / 'steps' / key))
    return stores

def saved_edits(folder):
    database = folder / 'edits.sqlite'
    if database.exists():
        if database.is_symlink():
            raise ValueError('Unexpected variant journal link')
        # Read a committed snapshot while a live preview may still be saving.
        uri = database.as_uri() + '?mode=ro'
        connection = sqlite3.connect(uri, uri=True)
        try:
            row = connection.execute('SELECT body FROM journal WHERE id = 1').fetchone()
            if row:
                return json.loads(row[0])
        finally:
            connection.close()
    portable = folder / 'edits.json'
    return read_json(portable) if portable.is_file() else None

def portable_original_edits(canvas, supplied):
    baseline = read_json(canvas / 'inspector-state.json') if (canvas / 'inspector-state.json').is_file() else None
    paired = canvas / 'paired-helper.local.json'
    if paired.is_file():
        ref = read_json(paired)
        if not re.fullmatch(r'[a-fA-F0-9-]{36}', ref['id']):
            raise ValueError('Unknown paired canvas identity')
        state = Path(ref['state'])
        binding = read_json(state / 'bindings.json').get(ref['origin'])
        if not binding or binding['id'] != ref['id']:
            raise ValueError('Canvas helper binding changed')
        journal_file = state / (ref['id'] + '-changes.json')
        journal = read_json(journal_file) if journal_file.exists() else {'version': 2, 'binding': binding, 'revision': 0, 'edits': []}
        if journal.get('version') != 2 or any(journal['binding'].get(k) != binding[k] for k in ('id','origin','source')):
            raise ValueError('Unknown paired canvas journal')
        registrations = {}
        for kind in ('colors', 'spacing', 'font-families', 'text-styles', 'button-size'):
            path = state / (ref['id'] + '-' + kind + '.json')
            if path.exists():
                registrations[kind] = read_json(path)
        current = {'version': 1, 'revision': journal['revision'], 'edits': journal['edits'],
                   'textStyleDefinitions': journal.get('textStyleDefinitions', []), 'registrations': registrations}
    else:
        current = saved_edits(canvas)
    if supplied:
        provided = read_json(Path(supplied))
        if current and provided != baseline and provided != current:
            raise ValueError('Supplied edits differ from the saved canvas. Reconcile the two histories before exporting.')
        return current or provided
    return current if current is not None else baseline

def export(directory, output, app, inspector_state=None):
    canvas, app = Path(directory).resolve(strict=True), Path(app).resolve(strict=True)
    output = Path(output).absolute()
    if not (app / 'index.html').is_file() or read_json(canvas / 'canvas-project.json')['version'] != 1:
        raise ValueError('Expected a saved canvas and a built original app')
    inspector_state = portable_original_edits(canvas, inspector_state)
    if output.is_relative_to(app) or output.is_relative_to(canvas):
        raise ValueError('Choose an archive destination outside the app and canvas')
    with tempfile.NamedTemporaryFile(dir=output.parent) as temp:
        with zipfile.ZipFile(temp.name, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=5) as z:
            z.writestr('package.json', json.dumps({'format': 'localhost-inspector-canvas', 'version': 1}))
            write_file(z, canvas / 'canvas-project.json', 'canvas-project.json')
            if inspector_state:
                encoded = json.dumps(inspector_state).encode('utf8')
                if SENSITIVE.search(encoded):
                    raise ValueError('Possible credential in Inspector edits')
                z.writestr('inspector-state.json', encoded)
            folders = sorted(f for f in (canvas / 'variants').iterdir() if FRAME_ID.fullmatch(f.name))
            registered = {id for f in folders for id, _, _ in frame_stores(f, read_json(f / 'frame.json'))}
            mapped = read_json(canvas / 'map.json')
            if any(v['id'] not in registered for v in mapped.get('variants', [])):
                raise ValueError('Save the preview files for every linked variant before exporting')
            for v in mapped.get('variants', []):
                v.pop('origin', None)
            z.writestr('map.json', json.dumps(mapped))
            for file in sorted(canvas.iterdir()):
                if file.name != 'map.json' and CAPTURE.fullmatch(file.name):
                    write_file(z, file, file.name)
            responses = {}
            activity_file = canvas / 'variant-activity.sqlite'
            if activity_file.is_symlink():
                raise ValueError('Unexpected canvas activity link')
            if activity_file.exists():
                with sqlite3.connect(activity_file.as_uri() + '?mode=ro', uri=True) as db:
                    if db.execute("SELECT 1 FROM sqlite_master WHERE name = 'responses'").fetchone():
                        responses = dict(db.execute('SELECT id, at FROM responses'))
            for folder in folders:
                if (folder / 'frame.json').is_symlink():
                    raise ValueError('Unexpected variant metadata link')
                frame = read_json(folder / 'frame.json')
                if frame['id'] != folder.name:
                    raise ValueError('Invalid saved frame ID')
                prefix = 'variants/' + folder.name
                for id, entry, store in frame_stores(folder, frame):
                    if id in responses:
                        entry['respondedAt'] = responses[id]
                    if store.is_symlink() or (folder / 'steps').is_symlink():
                        raise ValueError('Unexpected journal directory link')
                    edits = saved_edits(store)
                    if edits is not None:
                        z.writestr((store.relative_to(canvas) / 'edits.json').as_posix(), json.dumps(edits))
                data = json.dumps(frame).encode('utf8')
                if SENSITIVE.search(data):
                    raise ValueError('Possible credential in frame metadata')
                z.writestr(prefix + '/frame.json', data)
                copy_tree(z, folder / 'preview', prefix + '/preview')
                add_source(z, canvas, folder)
            copy_tree(z, app, 'original')
        os.link(temp.name, output)  # publish once; keep an existing archive intact

def unpack(archive, destination):
    target = Path(destination).absolute()
    if target.exists():
        raise ValueError('Choose a new destination directory')
    with tempfile.TemporaryDirectory(dir=target.parent) as staging:
        root = Path(staging) / 'canvas'
        root.mkdir()
        with zipfile.ZipFile(archive) as z:
            entries = z.infolist()
            if len(entries) > MAX_ENTRIES or sum(e.file_size for e in entries) > MAX_BYTES:
                raise ValueError('Archive exceeds local import limits')
            names = set()
            for entry in entries:
                rel = safe_name(entry.filename)
                folded = str(rel).casefold()
                if folded in names or stat.S_ISLNK(entry.external_attr >> 16) or excluded(rel):
                    raise ValueError('Unsafe or duplicate package entry: ' + str(rel))
                names.add(folded)
                if not (rel.parts[0] in {'variants', 'original', 'sources'} or
                        str(rel) in ('package.json', 'canvas-project.json', 'inspector-state.json') or CAPTURE.fullmatch(str(rel))):
                    raise ValueError('Unexpected package file: ' + str(rel))
                path = root / rel
                path.parent.mkdir(parents=True, exist_ok=True)
                with z.open(entry) as src, path.open('xb') as dest:
                    shutil.copyfileobj(src, dest)
        if read_json(root / 'package.json') != {'format': 'localhost-inspector-canvas', 'version': 1}:
            raise ValueError('Unknown canvas package')
        if read_json(root / 'canvas-project.json')['version'] != 1 or not (root / 'original/index.html').is_file():
            raise ValueError('Incomplete canvas package')
        variant_dir = root / 'variants'
        variant_dir.mkdir(exist_ok=True)
        registered = set()
        for frame in variant_dir.iterdir():
            if not FRAME_ID.fullmatch(frame.name) or read_json(frame / 'frame.json')['id'] != frame.name or not (frame / 'preview/index.html').is_file():
                raise ValueError('Invalid packaged variant')
            for id, _, store in frame_stores(frame, read_json(frame / 'frame.json')):
                registered.add(id)
                store.mkdir(parents=True, exist_ok=True)
                if (store / 'edits.sqlite').exists():
                    raise ValueError('Expected a portable JSON variant journal')
                if (store / 'edits.json').exists():
                    edits = read_json(store / 'edits.json')
                    if edits.get('version') != 1 or not isinstance(edits.get('edits'), list) or type(edits.get('revision')) is not int or edits['revision'] < 0:
                        raise ValueError('Unknown variant edit format')
            if (frame / 'source.json').exists():
                source = safe_name(read_json(frame / 'source.json')['path'])
                if not (root / source).exists():
                    raise ValueError('Missing packaged editable source')
        mapped = read_json(root / 'map.json')
        if not isinstance(mapped['frames'], list) or any(v['id'] not in registered for v in mapped.get('variants', [])):
            raise ValueError('Missing packaged canvas frame')
        root.rename(target)

if __name__ == '__main__':
    cmd, *args = sys.argv[1:]
    if cmd == 'export':
        export(*args)
    elif cmd == 'import':
        unpack(*args)
    else:
        sys.exit('Expected export or import')
