import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { injectedFiles, project } from '../../scripts/check-modules.mjs'

import { fixture } from './fixture.mjs'
import { connectPreviewDock, servePreviewDock } from '../../scripts/preview-dock.mjs'

export async function createHarness(options = {}) {
  const server = createServer(async (request, response) => {
    if (request.url === '/assets/inter-latin.woff2') {
      if (options.fontFailure) { response.writeHead(503); response.end(); return }
      response.setHeader('Content-Type', 'font/woff2')
      response.end(await readFile(join(project, 'extension/assets/inter-latin.woff2')))
    } else {
      if (options.dock && servePreviewDock(request, response, 'http://127.0.0.1:' + server.address().port)) return
      response.setHeader('Content-Type', 'text/html')
      response.end(fixture)
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.INSPECTOR_BROWSER ? { executablePath: process.env.INSPECTOR_BROWSER } : {}) })
    const page = await browser.newPage({ viewport: { width: 1100, height: 1400 }, deviceScaleFactor: 2 })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('http://127.0.0.1:' + server.address().port)
    const app = options.dock ? page.frames().find(frame => frame.parentFrame() === page.mainFrame()) : page
    if (options.dock) await app.evaluate(connectPreviewDock)
    await app.evaluate(settings => {
      window.chrome = { runtime: { getURL: path => location.origin + '/' + path } }
      window.__journal = settings.journal || []
      window.__revision = 0
      window.__saveCount = 0
      window.__settings = settings
      if (settings.restoreFailure) {
        const style = document.createElement('style')
        style.textContent = '#target { width: 240px !important }'
        document.head.append(style)
      }
      window.phaseABridge = async message => {
        const { type, expectedRevision } = message
        if (type === 'colorCatalog') return settings.colorCatalog ?? null
        if (type === 'spacingCatalog') return settings.spacingCatalog ?? null
        if (type === 'textStyleCatalog') {
          if (settings.failTextStyleCatalog) throw Error('Source unavailable')
          return settings.textStyleCatalog ?? null
        }
        if (type === 'load') return { revision: window.__revision, edits: structuredClone(window.__journal) }
        if (type === 'save' || type === 'saveTextStyle') {
          window.__saveCount++
          if (window.__settings.holdSave === window.__saveCount) await new Promise(resolve => { window.__releaseSave = resolve })
          if (window.__settings.failSave === window.__saveCount) {
            const error = Error('Simulated save failure')
            error.code = 'WRITE_REJECTED'
            throw error
          }
        }
        if (type === 'undo' && window.__settings.holdUndo) {
          await new Promise(resolve => { window.__releaseUndo = resolve })
        }
        if (type === 'reset' && window.__settings.holdReset) {
          await new Promise(resolve => { window.__releaseReset = resolve })
        }
        if (expectedRevision !== window.__revision) {
          const error = Error('Saved previews changed in another tab. Reload the page and try again.')
          error.code = 'STALE_JOURNAL'
          throw error
        }
        if (type === 'save') window.__journal.push(message.record)
        if (type === 'saveTextStyle') {
          window.__journal.push(...message.records.map(record => ({ ...record, group: message.records[0].id })))
        }
        if (type === 'undo') {
          const entry = window.__journal.find(edit => edit.id === message.id)
          window.__journal.forEach(edit => {
            if (edit === entry || (entry.group && entry.group === edit.group)) edit.undone = true
          })
        }
        if (type === 'reset') {
          window.__journal.forEach(edit => { if (edit.route === message.route) edit.undone = true })
        }
        return { revision: ++window.__revision }
      }
    }, options)
    if (options.appStyles) await app.addStyleTag({ content: options.appStyles })
    for (const file of (await injectedFiles()).filter(file => file !== 'bridge.js')) {
      await app.addScriptTag({ content: await readFile(join(project, 'extension', file), 'utf8') })
    }
    await app.evaluate(() => window.phaseAInspectorReady)
    await app.evaluate(() => window.LocalhostInspector.fontReady)
    const host = page.locator('#localhost-inspector')
    const open = async () => host.locator('#entry').click()
    const select = async (selector = 'body > #target') => app.locator(selector).click({ modifiers: ['Meta'], position: { x: 5, y: 5 } })
    const field = name => host.getByRole('spinbutton', { name, exact: true })
    const enter = async (name, value) => { await field(name).fill(String(value)); await field(name).press('Enter') }
    const journal = () => app.evaluate(() => window.__journal)
    const css = (property, selector = 'body > #target') => app.locator(selector).evaluate((node, key) => getComputedStyle(node).getPropertyValue(key), property)
    const settled = () => host.locator('#inspector-panel:not([aria-busy="true"])').waitFor({ state: 'attached' })
    const close = async () => {
      try { await browser.close(); assert.deepEqual(errors, [], 'No uncaught browser errors') }
      finally { await new Promise(resolve => server.close(resolve)) }
    }
    return { page, app, host, open, select, field, enter, journal, css, settled, close }
  } catch (error) {
    await browser?.close()
    await new Promise(resolve => server.close(resolve))
    throw error
  }
}
