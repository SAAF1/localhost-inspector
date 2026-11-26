// Generate previews offline or refresh one saved step in a short-lived capture worker.
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { canvasProject, canvasVariants } from './canvas.mjs'
import { readBuiltAsset, variantSnapshotFile, journalStamp, snapshotJournalKey } from './canvas-preview.mjs'
import { servePreviewAsset } from './workspace-assets.mjs'
import { capture, captureContext } from './capture-previews.mjs'
import { variantJournal } from './variant-journal.mjs'
import { variantCatalogs } from './variant-catalogs.mjs'
import { prepareOverview } from './preview-overview.mjs'

const [dir, flag, selected, ...extra] = process.argv.slice(2)
const overviewOnly = flag === '--overview' && selected === undefined
if (!dir || (flag !== undefined && !overviewOnly && (flag !== '--step' || !selected)) || extra.length || !await canvasProject(resolve(dir)))
  throw Error('Usage: node scripts/flow/prepare-variant-previews.mjs SAVED_CANVAS [--step ID | --overview]')
const root = resolve(dir)
const { viewport } = JSON.parse(await readFile(join(root, 'map.json'), 'utf8'))
const variants = overviewOnly ? [] : (await canvasVariants(root, selected?.split('~')[0])).filter(frame => !selected || frame.id === selected)
if (selected && !variants.length) throw Error('Unknown saved variant step')
const assets = join(root, 'variant-previews')
await mkdir(assets, { recursive: true })
const stage = await mkdtemp(join(assets, '.capture-'))
const index = Object.create(null)
let browser
let failures = 0

async function publish(file) {
  const path = join(stage, file)
  const digest = createHash('sha256').update(await readFile(path)).digest('hex')
  await rename(path, join(assets, digest + '.webp'))
  return digest
}

async function restoreEdits(page, origin, journal, expected) {
  // Only the same read operations used by the live editor are available to
  // this capture. The app build cannot mutate its journal during rendering.
  let loadedRevision
  const endpoint = origin + '/__inspector-flow/variant-inspector'
  await page.route(endpoint, async route => {
    const request = route.request()
    try {
      if (request.method() !== 'POST' || request.headers().origin !== origin) throw Error()
      const { type, route: path } = request.postDataJSON()
      if (!['load', 'colorCatalog', 'spacingCatalog', 'textStyleCatalog', 'fontFamilyCatalog'].includes(type)) throw Error()
      const value = await journal.handle({ type, route: path })
      if (type === 'load') loadedRevision = value.revision
      await route.fulfill({ json: { ok: true, value } })
    } catch { await route.fulfill({ status: 403, json: { ok: false } }) }
  })
  await page.evaluate(() => {
    const dock = document.createElement('aside')
    dock.id = 'variant-dock'
    dock.hidden = true
    dock.setAttribute('data-workspace-toolbar', '')
    document.documentElement.append(dock)
    void import('/__inspector-flow/variant-editor.mjs').then(({ mountVariantEditor }) => mountVariantEditor(dock))
      .catch(() => { dock.dataset.captureFailed = 'true' })
  })
  const restored = await page.waitForFunction(() => {
    const dock = document.querySelector(':root > #variant-dock')
    if (dock?.dataset.captureFailed) return 'failed'
    return dock?.firstElementChild?.dataset.previewRestoration === 'ready' && 'ready'
  }, null, { timeout: 6000 })
  if (await restored.jsonValue() !== 'ready' || loadedRevision !== expected.revision)
    throw Error('Saved edits could not be verified at the requested revision')
}

async function captureBuild(owner, steps, encoder) {
  const directory = join(root, 'variants', owner)
  const server = createServer(async (request, response) => {
    const host = '127.0.0.1:' + server.address().port
    try {
      if (request.headers.host !== host || request.method !== 'GET') throw Error()
      const path = decodeURIComponent(new URL(request.url, 'http://' + host).pathname)
      if (await servePreviewAsset(path, response)) return
      const asset = await readBuiltAsset(join(directory, 'preview'), path)
      response.writeHead(200, { 'content-type': asset.type }).end(asset.data)
    } catch { response.writeHead(404).end() }
  })
  await new Promise((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok))
  const origin = 'http://127.0.0.1:' + server.address().port
  try {
    for (const { id, route } of steps) {
      const step = id.split('~')[1]
      const journalPath = step ? join(directory, 'steps', step) : directory
      const journal = variantJournal(journalPath, id, { catalogs: variantCatalogs(directory) })
      let context
      try {
        const status = await journal.status()
        // Match the content box inside the canvas frame's two-pixel border.
        const size = { width: viewport.width - 4, height: viewport.height - 4 }
        context = await captureContext(browser, origin, size, 2)
        const page = await context.newPage()
        const url = new URL(route, origin)
        if (url.origin !== origin) throw Error('Expected a local preview route')
        const response = await page.goto(url.href, { waitUntil: 'load', timeout: 12000 })
        if (!response?.ok()) throw Error('Preview route unavailable')
        await page.waitForFunction(() => document.body?.innerText.trim() || document.querySelector('img,canvas,svg'), null, { timeout: 3000 })
        await page.evaluate(() => document.fonts.ready)
        if (page.url() !== url.href) throw Error('Preview route redirected')
        if (status.hasEdits) await restoreEdits(page, origin, journal, status)
        const high = await capture(page, encoder, stage, 'card.webp', Math.min(256, size.width))
        if (!high) throw Error('Frame exceeds the sharp capture budget')
        if (page.url() !== url.href || (status.hasEdits && !await page.evaluate(() =>
          document.querySelector(':root > #variant-dock > #localhost-inspector')?.dataset.previewRestoration === 'ready')))
          throw Error('The saved route or restored edits changed during capture')
        const stamp = journalStamp(journalPath)
        const latest = await journal.status()
        if (latest.revision !== status.revision || latest.fingerprint !== status.fingerprint)
          throw Error('Saved edits changed during capture')
        const background = await page.evaluate(() => [document.body, document.documentElement]
          .map(node => getComputedStyle(node).backgroundColor).find(color => color !== 'rgba(0, 0, 0, 0)') || 'white')
        index[id] = { route, ...viewport, revision: status.revision, fingerprint: status.fingerprint,
          background, small: await publish('card.webp'), sharp: await publish(high) }
        if (stamp && stamp === journalStamp(journalPath)) {
          index[id].hasEdits = latest.hasEdits
          index[id].journalKey = snapshotJournalKey(id, stamp, latest)
        }
      } catch (error) {
        failures++
        console.error(id + ' will use the live preview: ' + error.message)
      } finally { await context?.close() }
    }
  } finally { await new Promise(ok => server.close(ok)) }
}

try {
  browser = await chromium.launch({ executablePath: process.env.INSPECTOR_BROWSER })
  const encoder = await browser.newPage()
  for (const [owner, steps] of Map.groupBy(variants, frame => frame.id.split('~')[0]))
    await captureBuild(owner, steps, encoder)
  if (!overviewOnly && (!selected || index[selected])) {
    const manifest = join(stage, 'index.json')
    await writeFile(manifest, JSON.stringify(selected ? index[selected] : index))
    if (selected) {
      const steps = join(assets, 'steps')
      await mkdir(steps, { recursive: true })
      await rename(manifest, join(steps, variantSnapshotFile(selected, index[selected])))
    } else await rename(manifest, join(root, 'variant-previews.json'))
  }
  if (!overviewOnly) console.log('Prepared ' + Object.keys(index).length + ' of ' + variants.length + ' variant steps.')
  if (!selected) failures += await prepareOverview(root, stage, encoder)
  if (failures) process.exitCode = 1
} finally {
  await browser?.close()
  await rm(stage, { recursive: true, force: true })
}
