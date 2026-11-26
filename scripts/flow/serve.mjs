import { createHash, randomUUID } from 'node:crypto'
import { watch } from 'node:fs'
import { queueVariantCapture } from './variant-capture-queue.mjs'
import { createServer } from 'node:http'
import { readFile, realpath } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { serveWorkspaceAsset, servePreviewAsset } from './workspace-assets.mjs'
import { flowPath } from '../../extension/flow-attachment.js'

import { handleVariantInspector, variantJournal } from './variant-journal.mjs'
import { canvasActivity, activityFile } from './canvas-activity.mjs'
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
const previewOriginSession = randomUUID()
const activityListeners = new Set()
function refreshOpenCanvases() {
  for (const notify of activityListeners) notify()
}
const queueCapture = durableCanvas && queueVariantCapture(mapRoot, refreshOpenCanvases)
const mergeSavedFrames = durableCanvas && savedPreviewFrames(mapRoot, id => {
  queueCapture(id)
  refreshOpenCanvases()
})
const editor = durableCanvas && comparison?.role !== 'proposal' && (await canvasHelper(mapRoot, appRoot, 'http://127.0.0.1:' + port, process.env.INSPECTOR_CANVAS_HELPER_STATE) || variantJournal(mapRoot, 'original', {
  seed: 'inspector-state.json', catalogs: variantCatalogs(mapRoot, { canvas: mapRoot, sourceRoot: appRoot }),
}))

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

// Hash the same ordered rows on the map and stream paths without retaining a
// second complete serialized catalog. JSON strings escape literal newlines.
function activityVersion(variants, activity) {
  const hash = createHash('sha256').update(previewOriginSession)
  for (const row of variants) hash.update(JSON.stringify(row)).update('\n')
  hash.update('\0')
  for (const row of activity) hash.update(JSON.stringify(row)).update('\n')
  return hash.digest('hex')
}

// Notify open canvases when the launcher publishes or removes its link.
function streamProposalLink(origin, response, deferOrigins, knownVersion) {
  const watcher = watch(mapRoot, (_, name) => {
    if (!name || name === 'proposal-preview.json') void publish()
    if (!name || name === 'map.json' || name === activityFile || name === activityFile + '-journal') scheduleActivity()
  })
  response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' })
  let revision = 0
  async function publish() {
    const current = ++revision
    const comparison = await comparisonForOriginal(origin)
    if (current === revision && !response.destroyed) response.write('data: ' + JSON.stringify(comparison) + '\n\n')
  }
  let activityRevision = 0
  let activityTimer
  let firstCatalog = true
  async function publishActivity(sendOrigins = false) {
    const current = ++activityRevision
    try {
      const map = JSON.parse(await readFile(join(mapRoot, 'map.json'), 'utf8'))
      const useOnDemand = mergeSavedFrames && await mergeSavedFrames(map, deferOrigins)
      if (current !== activityRevision || response.destroyed) return
      const variants = map.variants ?? []
      const activity = canvasActivity(mapRoot, variants)
      if (knownVersion) {
        const version = activityVersion(variants, activity)
        if (version !== knownVersion) {
          const payload = { session: previewOriginSession, variants, activity }
          response.write('id: ' + version + '\nevent: catalog\ndata: ' + JSON.stringify(payload) + '\n\n')
          knownVersion = version
        } else if (firstCatalog) {
          response.write('id: ' + version + '\nevent: catalog-current\ndata: {}\n\n')
        }
        firstCatalog = false
        return
      }
      if (sendOrigins && mergeSavedFrames) {
        const entries = variants.map(({ id, origin, deferredOrigin, editable, hasEdits }) => ({ id, origin, deferredOrigin, editable, hasEdits }))
        const payload = useOnDemand ? { session: previewOriginSession, variants: entries } : entries
        response.write('event: preview-origins\ndata: ' + JSON.stringify(payload) + '\n\n')
      }
      response.write('event: activity\ndata: ' + JSON.stringify({ activity, variants }) + '\n\n')
    } catch { if (!response.destroyed) response.end() }
  }
  function scheduleActivity() {
    clearTimeout(activityTimer)
    activityTimer = setTimeout(publishActivity, 30)
  }
  const variantsWatcher = durableCanvas && watch(join(mapRoot, 'variants'), (_, name) => {
    if (!name || !name.startsWith('.')) scheduleActivity()
  })
  variantsWatcher?.on('error', () => response.end())
  watcher.on('error', () => response.end())
  activityListeners.add(scheduleActivity)
  response.on('close', () => {
    activityListeners.delete(scheduleActivity)
    watcher.close()
    variantsWatcher?.close()
    clearTimeout(activityTimer)
  })
  void publish().then(() => publishActivity(true))
}

async function serve(request, response) {
  const origin = 'http://127.0.0.1:' + port
  if (request.headers.host !== new URL(origin).host) {
    response.writeHead(404).end()
    return
  }
  const url = new URL(request.url, origin)
  const path = decodeURIComponent(url.pathname)
  if (editor && path === flowPath + 'workspace-inspector') return handleVariantInspector(request, response, new URL(origin), editor)
  if (request.method !== 'GET') { response.writeHead(404).end(); return }
  let data
  let type
  if (path.startsWith(flowPath)) {
    const relative = path.slice(flowPath.length)
    const deferOrigins = url.searchParams.get('previewOrigins') === 'on-demand' ||
      request.headers['x-inspector-preview-origins'] === 'on-demand'
    if (mergeSavedFrames && comparison?.role !== 'proposal' && relative === 'preview-origin') {
      const site = request.headers['sec-fetch-site']
      if ((site && site !== 'same-origin') || (request.headers.origin && request.headers.origin !== origin) ||
          (site !== 'same-origin' && request.headers.origin !== origin)) {
        response.writeHead(403).end()
        return
      }
      const id = url.searchParams.get('id')
      const preview = await mergeSavedFrames.resolveOrigin(id)
      if (!preview) { response.writeHead(404).end(); return }
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
        .end(JSON.stringify({ id, origin: preview }))
      return
    }
    if (mapRoot && relative === 'proposal-events' && comparison?.role !== 'proposal') {
      const knownVersion = deferOrigins && (request.headers['last-event-id'] || url.searchParams.get('knownVersion'))
      streamProposalLink(origin, response, deferOrigins, knownVersion)
      return
    }
    if (durableCanvas && relative === 'variant-previews/overview.json') {
      const file = join(await realpath(mapRoot), relative)
      if (await realpath(file).catch(() => null) !== file) { response.writeHead(404).end(); return }
      const bytes = await readFile(file)
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(bytes)
      return
    }
    if (durableCanvas && /^variant-previews\/[0-9a-f]{64}\.webp$/.test(relative)) {
      const root = await realpath(mapRoot)
      const file = join(root, relative)
      if (await realpath(file) !== file) { response.writeHead(404).end(); return }
      const bytes = await readFile(file)
      response.writeHead(200, { 'content-type': 'image/webp', 'cache-control': 'private, max-age=31536000, immutable',
        'x-content-type-options': 'nosniff' }).end(bytes)
      return
    }
    if (await (mapRoot ? serveWorkspaceAsset(path, response, Boolean(editor)) : servePreviewAsset(path, response))) return
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
        if (mergeSavedFrames && link?.role !== 'proposal') {
          if (await mergeSavedFrames(map, deferOrigins)) {
            map.previewOrigins = 'on-demand'
            map.previewOriginSession = previewOriginSession
          }
        }
        if (link?.role !== 'proposal') map.activity = canvasActivity(mapRoot, map.variants ?? [])
        if (map.previewOriginSession === previewOriginSession) {
          map.activityVersion = activityVersion(map.variants, map.activity)
        }
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
    plugins: [workspace, componentPreviewSites(appRoot), tableRenderSites(appRoot)],
    server: { host: '127.0.0.1', port: Number(port), strictPort: true, open: false },
  })
  await server.listen()
  console.log('Inspector project preview listening on ' + port)
} else {
  createServer(handleRequest).listen(Number(port), '127.0.0.1', () => console.log('Flow fixture listening on ' + port))
}
