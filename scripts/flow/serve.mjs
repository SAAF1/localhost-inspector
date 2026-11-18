import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import { serveWorkspaceAsset } from './workspace-assets.mjs'
import { flowPath } from '../../extension/flow-attachment.js'

const [builtApp, port, mapDirectory] = process.argv.slice(2)
if (!builtApp || !/^\d+$/.test(port ?? '')) throw Error('Usage: node scripts/flow/serve.mjs APP_BUILD PORT [MAP_DIRECTORY]')
const appRoot = resolve(builtApp)
const mapRoot = mapDirectory ? resolve(mapDirectory) : null
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json',
  '.mjs': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webp': 'image/webp' }

async function serve(request, response) {
  const origin = 'http://127.0.0.1:' + port
  if (request.headers.host !== new URL(origin).host || request.method !== 'GET') {
    response.writeHead(404).end()
    return
  }
  const path = decodeURIComponent(new URL(request.url, origin).pathname)
  let data
  let type
  if (path.startsWith(flowPath)) {
    const relative = path.slice(flowPath.length)
    if (mapRoot && await serveWorkspaceAsset(path, response)) return
    if (mapRoot && /^((map|previews)\.json|frame-\d+(\.png|-(desktop|tablet|phone)(-hug)?(-2x)?\.webp))$/.test(relative)) {
      data = await readFile(resolve(mapRoot, relative))
      type = types[extname(relative)]
    } else {
      response.writeHead(404).end()
      return
    }
  } else {
    let file = resolve(appRoot, '.' + path)
    if (!file.startsWith(appRoot + sep) && file !== appRoot) throw Error('Invalid asset')
    if (!extname(path) && !(await stat(file).catch(() => null))?.isFile()) file = resolve(appRoot, 'index.html')
    data = await readFile(file)
    type = types[extname(file)] ?? 'application/octet-stream'
  }
  response.writeHead(200, { 'content-type': type + (type.startsWith('text/') ? '; charset=utf-8' : ''),
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }).end(data)
}

createServer((request, response) => {
  void serve(request, response).catch(() => response.writeHead(404).end())
}).listen(Number(port), '127.0.0.1', () => console.log('Flow fixture listening on ' + port))
