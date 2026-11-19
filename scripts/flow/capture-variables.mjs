import { randomUUID } from 'node:crypto'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'
import { discoverVariablesCatalog } from '../../variables-catalog.mjs'
import { captureContext, verifyCaptureState } from './capture-previews.mjs'

const modules = ['ui/authored-styles', 'ui/text-style-values', 'ui/color-bindings', 'ui/spacing-gap', 'variables-audit']

export async function createAuditCapture(context, repo) {
  const catalogs = await discoverVariablesCatalog(repo)
  const scripts = await Promise.all(modules.map(name =>
    readFile(new URL('../../extension/' + name + '.js', import.meta.url), 'utf8')))
  // Keep the scanner's namespace local to this disposable capture session.
  await context.addInitScript({ content: `(() => {
    const window = { LocalhostInspector: {} };
    ${scripts.join(';\n')}
    globalThis[Symbol.for('localhost-inspector.audit-capture')] = window.LocalhostInspector.scanVariablesPage
  })()` })
  return async (page, frame, origin) => {
    if (frame.steps.length || !(await verifyCaptureState(page, frame, origin))) return null
    const result = await page.evaluate(({ info, catalogs }) => {
      const scan = globalThis[Symbol.for('localhost-inspector.audit-capture')](document, info, catalogs)
      for (const entry of scan.entries) for (const occurrence of entry.occurrences) delete occurrence.node
      return scan
    }, { info: { id: frame.route, label: frame.label, frameId: frame.id }, catalogs })
    // SPA navigation may have occurred between the earlier check and the scan.
    return await verifyCaptureState(page, frame, origin) ? result : null
  }
}

export async function writeAudit(output, scans) {
  const target = join(output, 'audit.json')
  const temp = target + '.' + randomUUID() + '.tmp'
  await writeFile(temp, JSON.stringify({ scans }))
  await rename(temp, target)
}

async function backfill(repo, output) {
  const map = JSON.parse(await readFile(join(output, 'map.json'), 'utf8'))
  if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(map.origin)) throw Error('Expected a localhost map')
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await captureContext(browser, map.origin, map.viewport)
    const scan = await createAuditCapture(context, repo)
    const page = await context.newPage()
    const pages = new Map(map.frames.filter(frame => !frame.steps.length).map(frame => [frame.route, frame]))
    const results = []
    for (const frame of pages.values()) {
      const url = new URL(frame.route, map.origin)
      if (url.origin !== map.origin || url.username || url.password) throw Error('Invalid mapped route')
      try {
        // Base pages only. Never replay the actions recorded for drawers, tabs or forms.
        const response = await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 8000 })
        if (!response?.ok()) throw Error('Page unavailable')
        const deadline = Date.now() + 2500
        while (!(await verifyCaptureState(page, frame, map.origin)) && Date.now() < deadline) await pause(50)
        const result = await scan(page, frame, map.origin)
        if (!result) throw Error('Page differs from its mapped state')
        results.push(result)
      } catch (error) {
        console.warn('Skipped', frame.route, error.message.split('\n')[0])
      }
    }
    if (!results.length) throw Error('No mapped base pages could be verified; previous audit preserved')
    await writeAudit(output, results)
    console.log('Audited', results.length, 'of', pages.size, 'base pages')
  } finally { await browser.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [repo, output] = process.argv.slice(2)
  if (!repo || !output) throw Error('Usage: node scripts/flow/capture-variables.mjs REPO MAP_DIRECTORY')
  await backfill(repo, output)
}
