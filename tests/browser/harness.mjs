import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { injectedFiles, project } from '../../scripts/check-modules.mjs'

import { dockFlowInspector } from '../../extension/flow-attachment.js'
import { serveWorkspaceAsset } from '../../scripts/flow/workspace-assets.mjs'
import { pendingEdits, removePendingEdit } from '../../journal-edits.mjs'
import { fixture } from './fixture.mjs'
import { connectPreviewDock, servePreviewDock } from '../../scripts/preview-dock.mjs'

export async function createHarness(options = {}) {
  const server = createServer(async (request, response) => {
    if (request.url === '/assets/inter-latin.woff2') {
      if (options.fontFailure) { response.writeHead(503); response.end(); return }
      response.setHeader('Content-Type', 'font/woff2')
      response.end(await readFile(join(project, 'extension/assets/inter-latin.woff2')))
    } else {
      const origin = 'http://127.0.0.1:' + server.address().port
      if (options.canvas) {
        if (await serveWorkspaceAsset(request.url, response)) return
        if (request.url === '/__inspector-flow/previews.json') {
          response.writeHead(options.flowPreviews ? 200 : 404, { 'content-type': 'application/json' })
          response.end(JSON.stringify(options.flowPreviews ?? null))
          return
        }
        if (/^\/__inspector-flow\/[^/]+\.(?:webp|png)$/.test(request.url)) {
          response.writeHead(200, { 'content-type': 'image/png' })
          response.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=', 'base64'))
          return
        }
        if (request.url === '/__inspector-flow/map.json') {
          response.writeHead(200, { 'content-type': 'application/json' })
          response.end(JSON.stringify({ origin, viewport: { width: 1100, height: 1356 },
            frames: options.flowFrames ?? [{ id: 'first', route: '/', label: 'Fixture', steps: [], checkpoint: [], image: 'frame-1.png' }],
            connections: [] }))
          return
        }
      } else if (options.dock && servePreviewDock(request, response, origin)) return
      response.setHeader('Content-Type', 'text/html')
      const flowPage = options.flowPages?.[request.url]
      if (flowPage) response.statusCode = flowPage.status ?? 200
      response.end(flowPage ? fixture + flowPage.body : fixture)
    }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  let browser
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.INSPECTOR_BROWSER ? { executablePath: process.env.INSPECTOR_BROWSER } : {}) })
    const page = await browser.newPage({ viewport: { width: 1100, height: 1400 }, deviceScaleFactor: 2, hasTouch: options.hasTouch })
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('http://127.0.0.1:' + server.address().port + (options.canvas ? '/__inspector-flow/' : '/'))
    if (options.canvas) await page.frameLocator('#app-preview').locator('#target').waitFor()
    const app = options.dock ? page.frames().find(frame => frame.parentFrame() === page.mainFrame()) : page
    if (options.canvas && options.dock) await app.evaluate(dockFlowInspector)
    else if (options.dock) await app.evaluate(connectPreviewDock)
    if (options.pendingEdits) {
      await page.exposeFunction('summarizeFixtureJournal', pendingEdits)
      await page.exposeFunction('removeFixtureEdit', (journal, id) => {
        try { return removePendingEdit(journal, id) }
        catch (error) { return { error: error.message } }
      })
    }
    await app.evaluate(settings => {
      // Existing tests use Playwright locators for the Inspector's internal controls.
      if (!settings.closedPanel) {
        const attachShadow = Element.prototype.attachShadow
        Element.prototype.attachShadow = function (options) {
          return attachShadow.call(this, this.id === 'localhost-inspector' ? { ...options, mode: 'open' } : options)
        }
      }
      window.chrome = { runtime: { getURL: path => location.origin + '/' + path } }
      if (settings.buttonSizeKey) {
        const button = document.querySelector('#other')
        button.setAttribute('data-slot', 'button')
        button.setAttribute('data-inspector-target', settings.buttonSizeKey)
        button.setAttribute('data-inspector-button-size', 'sm')
      }
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
        if (type === 'previewButtonSize') {
          const node = document.querySelector('#other')
          if (node.getAttribute('data-inspector-target') !== message.key ||
              node.getAttribute('data-inspector-button-size') !== message.before) return false
          node.setAttribute('data-inspector-button-size', message.requested)
          return true
        }
        const pending = async () => settings.pendingEdits
          ? await window.summarizeFixtureJournal(window.__journal.filter(edit => !edit.undone))
          : undefined
        if (type === 'load') return { revision: window.__revision, route: message.route, scopedPreviewTargets: !settings.legacyPreviewHelper, buttonSizeKey: settings.buttonSizeKey, pending: await pending(), edits: structuredClone(window.__journal.filter(edit => !edit.undone && edit.route === message.route)) }
        if (['save', 'saveTextStyle', 'saveButtonSize', 'saveSharedPadding', 'savePairedPadding'].includes(type)) {
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
        if (type === 'save' || type === 'saveButtonSize') window.__journal.push(message.record)
        if (['saveTextStyle', 'saveSharedPadding', 'savePairedPadding'].includes(type)) {
          window.__journal.push(...message.records.map(record => ({ ...record, group: message.records[0].id })))
        }
        if (type === 'undo') {
          const entry = window.__journal.find(edit => edit.id === message.id)
          window.__journal = window.__journal.filter(edit => edit !== entry && !(entry.group && edit.group === entry.group))
        }
        let rebased
        if (type === 'removeEdit') {
          const result = await window.removeFixtureEdit(window.__journal, message.id)
          if (result.error) throw Object.assign(Error(result.error), { code: 'WRITE_REJECTED' })
          window.__journal = result.edits
          rebased = result.rebased
        }
        if (type === 'reset') {
          window.__journal = window.__journal.filter(edit => edit.route !== message.route)
        }
        return { revision: ++window.__revision, pending: await pending(), rebased }
      }
    }, options)
    if (options.appStyles) await app.addStyleTag({ content: options.appStyles })
    for (const file of (await injectedFiles()).filter(file => file !== 'bridge.js')) {
      await app.addScriptTag({ content: await readFile(join(project, 'extension', file), 'utf8') })
    }
    await app.evaluate(() => window.phaseAInspectorReady)
    await app.evaluate(() => window.LocalhostInspector.fontReady)
    const host = page.locator('#localhost-inspector')
    const open = async () => (options.canvas ? page.locator('#inspector-toggle') : host.locator('#entry')).click()
    const showEdits = () => host.locator('#edits-tab').click()
    const previewAction = async name => {
      const design = host.locator('#design-tab')
      const wasDesign = await design.getAttribute('aria-selected') === 'true'
      if (wasDesign) await showEdits()
      await host.getByRole('button', { name, exact: true }).click()
      if (wasDesign) await design.click()
    }
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
    return { page, app, host, open, showEdits, previewAction, select, field, enter, journal, css, settled, close }
  } catch (error) {
    await browser?.close()
    await new Promise(resolve => server.close(resolve))
    throw error
  }
}
