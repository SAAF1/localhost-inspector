import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import { handleVariantInspector, variantJournal } from './variant-journal.mjs'
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

export function savedPreviewFrames(directory) {
  const origins = new Map()
  return async function merge(map) {
    const frames = new Map((map.variants ?? []).map(frame => [frame.id, frame]))
    await Promise.all((await canvasVariants(directory)).map(async ({ id, anchor, label, route, section, note, created, respondedAt }) => {
      const path = join(directory, 'variants', id)
      const journal = variantJournal(path, id)
      if (!origins.has(id)) {
        const origin = startPreview(join(path, 'preview'), journal).catch(error => {
          origins.delete(id)
          throw error
        })
        origins.set(id, origin)
      }
      // Keep insertion order independent of listener startup timing.
      frames.set(id, { id, anchor, label, route, section, note, created, respondedAt, editable: true })
      frames.get(id).origin = await origins.get(id)
      frames.get(id).hasEdits = await journal.hasEdits()
    }))
    map.variants = [...frames.values()]
  }
}
