import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { existsSync, statSync } from 'node:fs'
import { readFile, readdir, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { handleVariantInspector, variantJournal } from './variant-journal.mjs'
import { variantCatalogs } from './variant-catalogs.mjs'
import { canvasVariants } from './canvas.mjs'
import { servePreviewAsset } from './workspace-assets.mjs'
import { flowPath } from '../../extension/flow-attachment.js'

export const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webp': 'image/webp',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.wasm': 'application/wasm', '.woff': 'font/woff' }

export async function readBuiltAsset(root, path) {
  let file = resolve(root, '.' + path)
  if (!file.startsWith(root + sep) && file !== root) throw Error('Invalid asset')
  if (!extname(path) && !(await stat(file).catch(() => null))?.isFile()) file = join(root, 'index.html')
  let data = await readFile(file)
  const type = types[extname(file)] ?? 'application/octet-stream'
  if (type === 'text/html') {
    const script = '<script type="module" src="' + flowPath + 'preview-wheel.mjs"></script>'
    data = data.toString().replace(/^(\s*<!doctype[^>]*>)?/i, prefix => prefix + script)
  }
  return { data, type }
}

// Each preview gets its own origin so root-relative assets and SPA routes work.
// All listeners share this process and disappear when the canvas host exits.
async function startPreview(root, journal) {
  let address
  const server = createServer((request, response) => {
    async function reply() {
      if (request.headers.host !== address.host) throw Error('Invalid preview request')
      const path = decodeURIComponent(new URL(request.url, address).pathname)
      if (path === flowPath + 'variant-inspector') return handleVariantInspector(request, response, address, journal)
      if (request.method !== 'GET') throw Error('Invalid preview request')
      if (await servePreviewAsset(path, response)) return
      const { data, type } = await readBuiltAsset(root, path)
      response.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }).end(data)
    }
    void reply().catch(() => response.writeHead(404).end())
  })
  await new Promise((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok))
  address = new URL('http://127.0.0.1:' + server.address().port)
  server.unref()
  return address.origin
}

export function variantSnapshotFile(id, { revision, fingerprint }) {
  const suffix = '.' + revision + '.' + (fingerprint ?? 'pristine') + '.json'
  const prefix = id.length + suffix.length <= 255 ? id : '@' + createHash('sha256').update(id).digest('hex')
  return prefix + suffix
}


function fileStamp(file) {
  const info = statSync(file, { bigint: true, throwIfNoEntry: false })
  return info ? [info.dev, info.ino, info.size, info.mtimeNs, info.ctimeNs].join(':') : ''
}
export function journalStamp(path) {
  try {
    const db = join(path, 'edits.sqlite')
    const database = fileStamp(db)
    // A WAL or rollback journal can change the visible contents without
    // changing the main file. Use SQLite's normal transactional read then.
    if (database && (existsSync(db + '-wal') || existsSync(db + '-journal'))) return null
    const seed = fileStamp(join(path, 'edits.json'))
    return database || seed ? database + '|' + seed : ''
  } catch { return null }
}

// A captured status can be reused only for the same step and exact local
// journal files. A move to another machine or any write falls back to SQLite.
export function snapshotJournalKey(id, stamp, { revision, fingerprint, hasEdits }) {
  return createHash('sha256').update(JSON.stringify([id, stamp, revision, fingerprint, hasEdits])).digest('base64url')
}

function capturedStatus(picture, id, stamp) {
  if (!picture?.journalKey) return
  const { hasEdits, revision, fingerprint } = picture
  if (typeof hasEdits === 'boolean' && Number.isSafeInteger(revision) && revision >= 0 &&
      (fingerprint === null || /^[a-f0-9]{64}$/.test(fingerprint)) &&
      picture.journalKey === snapshotJournalKey(id, stamp, picture)) return { hasEdits, revision, fingerprint }
}

export function savedPreviewFrames(directory, onEdit) {
  const origins = new Map()
  const editFlags = new Map()
  const pristine = { revision: 0, hasEdits: false, fingerprint: null }
  async function journalStatus(path, id, picture, overrides) {
    const stamp = journalStamp(path)
    if (!stamp) {
      editFlags.delete(path)
      return stamp === '' ? pristine : variantJournal(path, id).status()
    }
    const cached = editFlags.get(path)
    if (cached?.stamp === stamp) return cached.value
    let value = capturedStatus(picture, id, stamp)
    if (!value && overrides.recent.size) {
      const recent = overrides.recent.get(id) ?? overrides.recent.get('@' + createHash('sha256').update(id).digest('hex'))
      if (recent) {
        const hint = capturedStatus(await readMetadata(id, join(stepsDir, recent.name)), id, stamp)
        if (hint && journalStamp(path) === stamp) value = hint
      }
    }
    if (value) {
      editFlags.set(path, { stamp, value })
      return value
    }
    value = await variantJournal(path, id).status()
    if (journalStamp(path) === stamp) editFlags.set(path, { stamp, value })
    return value
  }
  // Server-local cache keys don't belong in the public map or its version hash.
  function hideCaptureKey(picture) {
    if (picture?.journalKey) Object.defineProperties(picture, {
      journalKey: { enumerable: false }, hasEdits: { enumerable: false },
    })
  }
  const metadata = new Map()
  function optionalStamp(path) {
    try { return fileStamp(path) } catch { return '' }
  }
  function readMetadata(key, path) {
    const stamp = optionalStamp(path)
    if (!stamp) { metadata.delete(key); return null }
    const cached = metadata.get(key)
    if (cached?.path === path && cached.stamp === stamp) return cached.read
    const read = readFile(path, 'utf8').then(text => {
      const data = JSON.parse(text)
      if (key) hideCaptureKey(data)
      else for (const picture of Object.values(data)) hideCaptureKey(picture)
      return data
    }).catch(() => null)
    metadata.set(key, { path, stamp, read })
    return read
  }
  const stepsDir = join(directory, 'variant-previews', 'steps')
  function indexOverrides(names) {
    const recent = new Map()
    for (const name of names) {
      const parts = /^(.*)\.(\d+)\.([a-f0-9]{64}|pristine)\.json$/.exec(name)
      if (!parts) continue
      const [, id, revision] = parts
      if (Number(revision) > (recent.get(id)?.revision ?? -1)) recent.set(id, { revision: Number(revision), name })
    }
    return { files: new Set(names), recent }
  }
  let listingStamp
  let listing
  function listOverrides() {
    const stamp = optionalStamp(stepsDir)
    if (stamp !== listingStamp) {
      listingStamp = stamp
      listing = stamp ? readdir(stepsDir).then(indexOverrides).catch(() => indexOverrides([])) : indexOverrides([])
    }
    return listing
  }
  function originFor(id, path, journalPath) {
    if (!origins.has(id)) {
      const journal = variantJournal(journalPath, id, { catalogs: variantCatalogs(path), onEdit: () => onEdit?.(id) })
      const origin = startPreview(join(path, 'preview'), journal).catch(error => {
        origins.delete(id)
        throw error
      })
      origins.set(id, origin)
    }
    return origins.get(id)
  }

  async function resolveOrigin(id) {
    if (typeof id !== 'string' || id.length > 257) return
    const [owner, step] = id.split('~')
    if (!owner || !(await canvasVariants(directory, owner)).some(frame => frame.id === id)) return
    const path = join(directory, 'variants', owner)
    return originFor(id, path, step ? join(path, 'steps', step) : path)
  }

  async function merge(map, deferOrigins = false) {
    const [index, overrides] = await Promise.all([readMetadata('', join(directory, 'variant-previews.json')), listOverrides()])
    const frames = new Map((map.variants ?? []).map(frame => [frame.id, frame]))
    await Promise.all((await canvasVariants(directory)).map(async ({ id, anchor, label, route, section, sectionPath, note, reviewNote, created, respondedAt }) => {
      const [owner, step] = id.split('~')
      const path = join(directory, 'variants', owner)
      const journalPath = step ? join(path, 'steps', step) : path
      // Keep insertion order independent of journal reads and listener startup.
      const frame = { id, anchor, label, route, section, sectionPath, note, reviewNote, created, respondedAt, editable: true }
      frames.set(id, frame)
      const status = await journalStatus(journalPath, id, index?.[id], overrides)
      frame.hasEdits = status.hasEdits
      frame.revision = status.revision
      const filename = variantSnapshotFile(id, status)
      const override = overrides.files.has(filename) && await readMetadata(id, join(stepsDir, filename))
      frame.snapshot = [override, index?.[id]].find(picture => picture?.route === route &&
        (picture.revision ?? 0) === status.revision && (picture.fingerprint ?? null) === status.fingerprint &&
        Number.isSafeInteger(picture.width) && Number.isSafeInteger(picture.height) &&
        [picture.small, picture.sharp].every(digest => typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest)))
      if (deferOrigins && frame.snapshot && !origins.has(id)) frame.deferredOrigin = true
      else frame.origin = await originFor(id, path, journalPath)
    }))
    map.variants = [...frames.values()]
  }
  return Object.assign(merge, { resolveOrigin })
}
