import { readFile } from 'node:fs/promises'
import { flowPath } from '../../extension/flow-attachment.js'

const assets = new Map([
  ['', ['workspace.html', 'text/html']],
  ['workspace.css', ['workspace.css', 'text/css']],
  ['workspace.mjs', ['workspace.mjs', 'text/javascript']],
  ['render-frames.mjs', ['render-frames.mjs', 'text/javascript']],
  ['replay.mjs', ['replay.mjs', 'text/javascript']],
  ['page-state.mjs', ['page-state.mjs', 'text/javascript']],
])

export async function serveWorkspaceAsset(path, response) {
  if (!path.startsWith(flowPath)) return false
  const asset = assets.get(path.slice(flowPath.length))
  if (!asset) return false
  const [file, type] = asset
  const data = await readFile(new URL(file, import.meta.url))
  response.writeHead(200, { 'content-type': type + '; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff' }).end(data)
  return true
}
