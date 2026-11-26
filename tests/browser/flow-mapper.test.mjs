import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chromium } from 'playwright'
import { serveWorkspaceAsset } from '../../scripts/flow/workspace-assets.mjs'
import test from 'node:test'
import { promisify } from 'node:util'
import { project } from '../../scripts/check-modules.mjs'

const exec = promisify(execFile)

test('mapper preserves URL states and waits for a delayed rendered branch', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'inspector-mapper-test-'))
  const output = join(temporary, 'map')
  let actionRequests = 0
  let browser
  const server = createServer(async (request, response) => {
    if (await serveWorkspaceAsset(request.url, response)) return
    const asset = /^\/__inspector-flow\/(map\.json|previews\.json|audit\.json|frame-\d+[-\w]*\.(?:webp|png))$/.exec(request.url)
    if (asset) {
      const file = await readFile(join(output, asset[1])).catch(() => null)
      response.writeHead(file ? 200 : 404, { 'content-type': asset[1].endsWith('.json') ? 'application/json' :
        asset[1].endsWith('.png') ? 'image/png' : 'image/webp' }).end(file)
      return
    }
    const url = new URL(request.url, 'http://127.0.0.1')
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    if (url.pathname === '/approve') actionRequests++
    if (url.pathname === '/project') {
      const name = url.searchParams.get('tab') === 'usage' ? 'Usage' : 'Members'
      response.end('<main><h1>Loading…</h1><script>setTimeout(() => document.querySelector("h1").textContent="' +
        name + '", 300)</script></main>')
    } else if (url.pathname === '/hash') {
      response.end('<main><h1></h1><script>document.querySelector("h1").textContent=location.hash.slice(2)</script></main>')
    } else {
      response.end(`<style>@media(max-width: 1000px) { #show-details { display: none } }</style><main><h1>Home</h1>
        <a href="/project?tab=usage">Usage</a><a href="/project?tab=members">Members</a>
        <a href="/hash#/details">Details</a><a href="/hash#/billing">Billing</a>
        <a href="/approve?id=4">Approve</a><a href="/hidden-link" style="visibility:hidden">Hidden link</a>
        <span id="details-button" hidden>Show details</span>
        <button id="show-details" aria-haspopup="dialog" aria-labelledby="details-button" onclick="setTimeout(() => document.getElementById('details').showModal(), 450)">⚙</button>
        <dialog id="details" aria-label="Delayed details">Loaded</dialog>
        <div role="tablist">
          <button role="tab" aria-selected="true" id="open-tab">Open</button>
          <button role="tab" aria-selected="false" onclick="this.setAttribute('aria-selected', 'true'); document.getElementById('open-tab').setAttribute('aria-selected', 'false')">Paid</button>
        </div>
        <div>
          <button aria-pressed="true" id="every">Every item</button>
          <button aria-pressed="false" onclick="document.querySelector('#every').setAttribute('aria-pressed','false');this.setAttribute('aria-pressed','true')">Unassigned</button>
        </div>
        <button aria-pressed="false" onclick="fetch('/approve')">Favorite</button>
        </main>`)
    }
  })
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const origin = 'http://127.0.0.1:' + server.address().port
    await exec(process.execPath, [join(project, 'scripts/flow/map.mjs'), temporary, origin, output],
      { timeout: 20000 })
    const { frames, connections } = JSON.parse(await readFile(join(output, 'map.json'), 'utf8'))
    const labels = new Map(frames.filter(frame => !frame.steps.length).map(frame => [frame.route, frame.label]))
    assert.deepEqual([...labels.entries()], [
      ['/', 'Home'],
      ['/project?tab=usage', 'Usage'],
      ['/project?tab=members', 'Members'],
      ['/hash#/details', 'details'],
      ['/hash#/billing', 'billing'],
    ])
    const { scans } = JSON.parse(await readFile(join(output, 'audit.json'), 'utf8'))
    assert.deepEqual(scans.map(scan => scan.page.id), [...labels.keys()])
    const home = scans.find(scan => scan.page.id === '/')
    assert.ok(home.entries.some(entry => entry.category === 'typography' &&
      entry.occurrences.some(use => use.label === 'Home' && !('node' in use))))
    const every = { role: 'pressed-option', label: JSON.stringify(['Every item', 'Every item', 'Unassigned']) }
    const delayed = frames.find(frame => frame.label === 'Show details')
    assert.deepEqual(delayed?.checkpoint, [{ role: 'dialog', label: 'Delayed details' }, every])
    assert.ok(connections.some(edge => edge.to === delayed.id && edge.observed))
    const paid = frames.find(frame => frame.label === 'Paid')
    assert.equal(paid?.route, '/')
    const unassigned = { role: 'pressed-option', label: JSON.stringify(['Unassigned', 'Every item', 'Unassigned']) }
    assert.deepEqual(paid?.checkpoint, [{ role: 'selected-tab', label: 'Paid' }, every])
    assert.ok(frames.find(frame => frame.route === '/' && !frame.steps.length)?.checkpoint
      .some(check => check.label === every.label))
    assert.deepEqual(frames.find(frame => frame.label === 'Unassigned')?.checkpoint, [unassigned])
    assert.ok(!frames.some(frame => frame.label === 'Favorite'))
    const previews = JSON.parse(await readFile(join(output, 'previews.json'), 'utf8'))
    assert.ok(previews[delayed.id].desktop.fixed)
    assert.equal(previews[delayed.id].phone.unavailable, 'hidden-control')
    assert.equal(previews[delayed.id].tablet.unavailable, 'hidden-control')
    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
    await page.goto(origin + '/__inspector-flow/')
    await page.frameLocator('#app-preview').getByRole('heading', { name: 'Home' }).waitFor()
    await page.getByRole('button', { name: 'Expand flow', exact: true }).click()
    const fitCanvas = () => page.locator('#zoom-preset').evaluate(control => {
      control.value = 'fit'
      control.dispatchEvent(new Event('change'))
    })
    await fitCanvas()
    await page.getByRole('button', { name: 'Show details', exact: true }).click()
    const dialog = page.frameLocator('#app-preview').getByRole('dialog', { name: 'Delayed details' })
    await dialog.waitFor()
    await page.getByRole('button', { name: 'Canvas view settings' }).click()
    await page.getByRole('menuitemradio', { name: /Phone/ }).click()
    const switchToDesktop = page.getByRole('button', { name: /Desktop only.*Switch canvas to Desktop/ })
    await switchToDesktop.waitFor()
    await dialog.waitFor({ state: 'hidden' })
    await page.locator('#frame-view-toggle[aria-disabled=false]').waitFor()
    await fitCanvas()
    await switchToDesktop.click()
    await fitCanvas()
    await page.getByRole('button', { name: 'Show details', exact: true }).click()
    await dialog.waitFor()
    await fitCanvas()
    await page.getByRole('button', { name: 'Paid', exact: true }).click()
    await page.frameLocator('#app-preview').getByRole('tab', { name: 'Paid', selected: true }).waitFor()
    assert.equal(actionRequests, 0)
  } finally {
    await browser?.close()
    if (server.listening) await new Promise(resolve => server.close(resolve))
    await rm(temporary, { recursive: true, force: true })
  }
})
