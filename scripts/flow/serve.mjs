import { preparedStyles } from './prepared-css.mjs'
import { preparedSites } from './prepared-sites.mjs'
import { createHash, randomUUID } from 'node:crypto'
import { watch } from 'node:fs'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { serveWorkspaceAsset, servePreviewAsset } from './workspace-assets.mjs'
import { flowPath } from '../../extension/flow-attachment.js'

import { handleVariantInspector, variantJournal } from './variant-journal.mjs'
import { canvasHelper } from './canvas-helper.mjs'
import { variantCatalogs } from './variant-catalogs.mjs'
import { canvasProject, linkedCanvas } from './canvas.mjs'
import { readBuiltAsset, savedPreviewFrames, types } from './canvas-preview.mjs'

const sourceMode = process.argv[2] === '--source'
const [builtApp, port, mapDirectory, compareFlag, otherPort, ...extra] = process.argv.slice(sourceMode ? 3 : 2)
if (!builtApp || !/^\d+$/.test(port ?? '')) throw Error('Usage: node scripts/flow/serve.mjs [--source] APP_DIRECTORY PORT [MAP_DIRECTORY]')
const comparison = compareFlag && {
  role: compareFlag === '--original-port' ? 'proposal' : 'original',
  otherOrigin: 'http://127.0.0.1:' + otherPort,
}
if (comparison && (!['--original-port', '--proposal-port'].includes(compareFlag) || !mapDirectory ||
    !/^\d+$/.test(otherPort ?? '') || Number(otherPort) < 1 || Number(otherPort) > 65535 ||
    Number(port) === Number(otherPort) || extra.length)) {
  throw Error('Expected MAP_DIRECTORY followed by --proposal-port PORT or --original-port PORT.')
}
const appRoot = resolve(builtApp)
const mapRoot = mapDirectory ? resolve(mapDirectory) : await linkedCanvas(appRoot)
const durableCanvas = await canvasProject(mapRoot)
const mergeSavedFrames = durableCanvas && savedPreviewFrames(mapRoot)
const origin = 'http://127.0.0.1:' + port
let editor
if (durableCanvas && comparison?.role !== 'proposal') {
  if (process.env.INSPECTOR_CANVAS_HELPER_STATE) {
    // A new app must already be listening before its process can be bound.
    // Verify the binding on the first request and retry a premature request.
    let paired
    editor = { async handle(message) {
      paired ??= canvasHelper(mapRoot, appRoot, origin, process.env.INSPECTOR_CANVAS_HELPER_STATE)
      let client
      try { client = await paired } catch (error) { paired = undefined; throw error }
      return client.handle(message)
    } }
  } else {
    editor = await canvasHelper(mapRoot, appRoot, origin) || variantJournal(mapRoot, 'original', {
      seed: 'inspector-state.json', catalogs: variantCatalogs(mapRoot, { canvas: mapRoot, sourceRoot: appRoot }),
    })
  }
}

async function comparisonForOriginal(origin) {
  try {
    const link = JSON.parse(await readFile(join(mapRoot, 'proposal-preview.json'), 'utf8'))
    const other = new URL(link.proposalOrigin)
    if (link.originalOrigin === origin && other.origin !== origin && link.proposalOrigin === other.origin &&
        other.protocol === 'http:' && other.hostname === '127.0.0.1' && other.port) {
      return { role: 'original', otherOrigin: other.origin, context: link.context }
    }
  } catch { /* No active proposal in this map. */ }
  return null
}

// Notify open canvases when the launcher publishes or removes its link.
function streamProposalLink(origin, response) {
  const watcher = watch(mapRoot, (_, name) => {
    if (!name || name === 'proposal-preview.json') void publish()
  })
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
  let revision = 0
  async function publish() {
    const current = ++revision
    const comparison = await comparisonForOriginal(origin)
    if (current === revision && !response.destroyed) response.write('data: ' + JSON.stringify(comparison) + '\n\n')
  }
  watcher.on('error', () => response.end())
  response.on('close', () => watcher.close())
  void publish()
  if (mergeSavedFrames) {
    const saved = {}
    void mergeSavedFrames(saved).then(() => {
      if (!response.destroyed) response.write('event: preview-origins\ndata: ' + JSON.stringify(
        saved.variants.map(({ id, origin, editable, hasEdits }) => ({ id, origin, editable, hasEdits }))) + '\n\n')
    }).catch(() => response.end())
  }
}

async function serve(request, response) {
  const origin = 'http://127.0.0.1:' + port
  if (request.headers.host !== new URL(origin).host) {
    response.writeHead(404).end()
    return
  }
  const path = decodeURIComponent(new URL(request.url, origin).pathname)
  if (path === flowPath+'duplicate-design' && process.send && process.env.INSPECTOR_PREPARED_SITES) {
    if(request.method!=='POST' || request.headers.origin!==origin || request.headers['content-type']!=='application/json'){
      response.writeHead(403).end()
      return
    }
    const id=randomUUID()
    const finish=message=>{
      if(message?.id!==id)return
      clearTimeout(timer)
      process.off('message',finish)
      response.writeHead(message.error?409:201,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify(message))
    }
    const timer=setTimeout(()=>finish({id,error:'Copying timed out. Reload to check available designs.'}),60000)
    process.on('message',finish)
    process.send({type:'fork-studio',id})
    return
  }
  if (editor && path === flowPath + 'workspace-inspector') return handleVariantInspector(request, response, new URL(origin), editor)
  if (request.method !== 'GET') { response.writeHead(404).end(); return }
  let data
  let type
  if (path.startsWith(flowPath)) {
    const relative = path.slice(flowPath.length)
    if (mapRoot && relative === 'proposal-events' && comparison?.role !== 'proposal') {
      streamProposalLink(origin, response)
      return
    }
    if (await (mapRoot ? serveWorkspaceAsset(path, response, Boolean(editor) && new URL(request.url, origin).searchParams.get('editor') !== 'extension') : servePreviewAsset(path, response))) return
    if (mapRoot && /^((map|previews|audit)\.json|frame-\d+(\.png|-(desktop|tablet|phone)(-hug)?(-2x)?\.webp))$/.test(relative)) {
      // Candidate screenshots and inventories must never come from the original.
      if (comparison?.role === 'proposal' && relative !== 'map.json') {
        response.writeHead(404).end()
        return
      }
      data = await readFile(resolve(mapRoot, relative))
      if (relative === 'map.json') {
        const map = JSON.parse(data)
        const link = comparison || await comparisonForOriginal(origin)
        const originalOrigin = link?.role === 'proposal' ? link.otherOrigin : origin
        if (!durableCanvas && map.origin !== originalOrigin) throw Error('Map belongs to another app')
        if (mergeSavedFrames && link?.role !== 'proposal') await mergeSavedFrames(map)
        if (editor) map.canvasId = createHash('sha256').update(mapRoot).digest('hex')
        map.origin = origin
        map.comparison = link
        map.proposalEvents = comparison?.role !== 'proposal'
        if (link?.role === 'proposal') {
          for (const frame of map.frames) delete frame.image
        }
        data = JSON.stringify(map)
      }
      type = types[extname(relative)]
    } else {
      response.writeHead(404).end()
      return
    }
  } else {
    const asset = await readBuiltAsset(appRoot, path)
    data = asset.data
    type = asset.type
  }
  response.writeHead(200, { 'content-type': type + (type.startsWith('text/') ? '; charset=utf-8' : ''),
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }).end(data)
}

function handleRequest(request, response) {
  void serve(request, response).catch(() => response.writeHead(404).end())
}

if (sourceMode) {
  // Use the project's own Vite configuration, aliases, React version and file watcher.
  process.chdir(appRoot)
  const localRequire = createRequire(join(appRoot, 'package.json'))
  const { createServer: createViteServer } = await import(pathToFileURL(localRequire.resolve('vite')))
  const { componentPreviewSites } = await import('./component-preview-sites.mjs')
  const { tableRenderSites } = await import('./table-render-sites.mjs')
  const workspace = {
    name: 'localhost-inspector-workspace',
    enforce: 'pre',
    transformIndexHtml() {
      return [{ tag: 'script', attrs: { type: 'module', src: flowPath + 'preview-wheel.mjs' }, injectTo: 'head' }]
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0].startsWith(flowPath)) handleRequest(request, response)
        else next()
      })
    },
  }
  const server = await createViteServer({
    root: appRoot,
    ...(comparison?.role === 'proposal' ? { cacheDir: resolve(appRoot, '../vite-cache') } : {}),
    ...(process.env.INSPECTOR_VITE_CACHE ? {cacheDir: resolve(process.env.INSPECTOR_VITE_CACHE)} : {}),
    plugins: [workspace, preparedStyles(appRoot, process.env.INSPECTOR_PREPARED_SITES), preparedSites(appRoot, process.env.INSPECTOR_PREPARED_SITES), componentPreviewSites(appRoot), tableRenderSites(appRoot)],
    server: { host: '127.0.0.1', port: Number(port), strictPort: true, open: false },
  })
  await server.listen()
  console.log('Inspector project preview listening on ' + port)
} else {
  createServer(handleRequest).listen(Number(port), '127.0.0.1', () => console.log('Flow fixture listening on ' + port))
}
