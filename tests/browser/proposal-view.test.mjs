import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { chromium } from 'playwright'

async function port() {
  const socket = createServer()
  socket.listen(0, '127.0.0.1')
  await once(socket, 'listening')
  const value = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  return value
}

test('linked proposals share one canvas while retaining app content, filters and replayed state', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'inspector-comparison-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const originalPort = await port()
  const original = 'http://127.0.0.1:' + originalPort
  const proposalPort = await port()
  const proposal = 'http://127.0.0.1:' + proposalPort
  const route = '/records'
  const base = { id: 'records', route, label: 'Records', heading: 'Records', steps: [], checkpoint: [], image: 'frame-1.png' }
  const details = { ...base, id: 'details', steps: [{ role: 'button', label: 'Details' }],
    checkpoint: [{ role: 'dialog', label: 'Edit details' }] }
  await writeFile(join(directory, 'map.json'), JSON.stringify({
    origin: original, frames: [base, details], connections: [], viewport: { width: 1000, height: 700 },
  }))
  for (const [version, hostPort, switches] of [['Original', originalPort, []], ['Proposal', proposalPort, ['--original-port', String(originalPort)]]]) {
    const app = join(directory, version)
    await mkdir(app)
    await writeFile(join(app, 'index.html'), `<main><h1>Records</h1><h2>${version}</h2>
      <button onclick="document.querySelector('dialog').showModal()">Details</button>
      <dialog aria-label="Edit details"><label>Notes<input></label><a href="/records#target" target="_blank">Open record</a></dialog></main>`)
    const child = spawn(process.execPath, ['scripts/flow/serve.mjs', app, String(hostPort), directory, ...switches])
    t.after(() => child.kill())
    await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(([code]) => {
      throw Error('Preview host exited ' + code)
    })])
  }
  const mapUrl = '/__inspector-flow/map.json'
  assert.equal((await fetch(original + mapUrl).then(r => r.json())).comparison, null)
  const linkFile = join(directory, 'proposal-preview.json')
  async function publishLink() {
    await writeFile(linkFile + '.tmp', JSON.stringify({ originalOrigin: original, proposalOrigin: proposal,
      context: { frame: 'details', page: '/records?state=open', expanded: true } }))
    await rename(linkFile + '.tmp', linkFile)
  }
  const candidateMap = await fetch(proposal + mapUrl).then(r => r.json())
  assert.equal(candidateMap.frames[0].image, undefined)
  assert.equal(candidateMap.comparison.otherOrigin, original)
  const browser = await chromium.launch({ executablePath: process.env.INSPECTOR_BROWSER })
  t.after(() => browser.close())
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const workspace = '/__inspector-flow/'
  const network = await page.context().newCDPSession(page)
  await network.send('Network.enable')
  const initialLink = once(network, 'Network.eventSourceMessageReceived', { signal: AbortSignal.timeout(10000) })
  await page.goto(original + workspace + '#context=1&frame=records&page=%2Frecords%3Fstate%3Dopen')
  assert.equal((await initialLink)[0].data, 'null')
  const frame = page.frameLocator('#app-preview')
  const records = frame.getByRole('heading', { name: 'Records', exact: true })
  await records.waitFor()
  await page.waitForFunction(() => document.querySelector('#app-preview')?.contentWindow?.location.search === '?state=open')
  const immediateReturn = await records.evaluate(node => {
    const app = node.ownerDocument.defaultView
    app.history.replaceState(app.history.state, '', '/records')
    return new URLSearchParams(app.parent.location.hash.slice(1)).get('page')
  })
  assert.equal(immediateReturn, '/records')
  await page.reload()
  assert.equal(await records.evaluate(node => node.ownerDocument.location.search), '')
  await records.evaluate(node => node.ownerDocument.defaultView.history.replaceState(null, '', '/records?state=open'))
  await frame.getByRole('button', { name: 'Details' }).click()
  await page.waitForURL(url => new URLSearchParams(url.hash.slice(1)).get('frame') === 'details')
  assert.equal(new URL(page.url()).search, '')
  await page.getByRole('button', { name: 'Expand flow', exact: true }).click()
  await page.waitForURL(url => new URLSearchParams(url.hash.slice(1)).get('view') === 'canvas')
  const canvasUrl = page.url()
  const frameUrl = frame => new URL(frame.url() || 'about:blank')
  async function pairedApps(primaryOrigin, secondaryOrigin) {
    const routeOn = origin => frame => {
      const current = frameUrl(frame)
      return current.origin === origin && current.pathname === route
    }
    if (!page.frames().some(routeOn(secondaryOrigin))) {
      await page.waitForEvent('framenavigated', { predicate: routeOn(secondaryOrigin), timeout: 8000 })
    }
    const first = page.frames().find(routeOn(primaryOrigin))
    const second = page.frames().find(routeOn(secondaryOrigin))
    for (const [app, version] of [[first, primaryOrigin === original ? 'Original' : 'Proposal'],
      [second, secondaryOrigin === original ? 'Original' : 'Proposal']]) {
      await app.getByRole('heading', { name: version }).waitFor()
      await app.getByRole('dialog', { name: 'Edit details' }).waitFor()
      assert.equal(new URL(app.url()).search, '?state=open')
    }
    assert.equal(page.frames().filter(frame => frameUrl(frame).pathname === workspace).length, 1)
    assert.equal(page.frames().filter(routeOn(secondaryOrigin)).length, 1)
    assert.equal(page.frames().filter(routeOn(primaryOrigin)).length, 1)
    return [first, second]
  }
  assert.equal(page.frames().some(frame => frameUrl(frame).origin === proposal), false)
  await publishLink()
  const [originalApp, proposalApp] = await pairedApps(original, proposal)
  const originalBounds = await page.locator('#app-preview').boundingBox()
  const proposalBounds = await page.locator('iframe[title="Proposal preview"]').boundingBox()
  assert.ok(proposalBounds.x > originalBounds.x + originalBounds.width)
  assert.ok(originalBounds.x >= 0 && proposalBounds.x + proposalBounds.width <= page.viewportSize().width)
  assert.equal(await page.getByRole('combobox', { name: 'Design version' }).count(), 0)
  await page.getByRole('button', { name: 'Interact with Proposal' }).click()
  const note = proposalApp.getByRole('textbox', { name: 'Notes' })
  await proposalApp.getByRole('link', { name: 'Open record' }).click({ modifiers: ['Meta'] })
  assert.equal(page.context().pages().length, 1)
  await note.click()
  await note.fill('For the draft')
  async function panOverApp(hitTarget, selector, description) {
    // Hit the real app document. A wheel dispatched on the parent viewport
    // bypasses the cross-origin iframe that receives physical trackpad input.
    await hitTarget.hover()
    const start = await page.locator(selector).boundingBox()
    await page.mouse.wheel(48, 0)
    await page.waitForFunction(({ selector, x }) => {
      const current = document.querySelector(selector).getBoundingClientRect().x
      return Math.abs(current - (x - 96)) < 1
    }, { selector, x: start.x },
    { timeout: 3000 }).catch(error => { throw Error(description + ' did not pan by twice the wheel delta', { cause: error }) })
  }
  await panOverApp(note, 'iframe[title="Proposal preview"]', 'active nested proposal')
  assert.equal(await note.inputValue(), 'For the draft')

  await note.press('Escape')
  await page.getByRole('button', { name: 'Interact with Proposal' }).waitFor()
  assert.equal(await originalApp.getByRole('textbox', { name: 'Notes' }).inputValue(), '')
  assert.equal(page.url(), canvasUrl)

  const repeatedLink = once(network, 'Network.eventSourceMessageReceived', { signal: AbortSignal.timeout(10000) })
  await publishLink()
  assert.equal(JSON.parse((await repeatedLink)[0].data).otherOrigin, proposal)
  assert.equal(await note.inputValue(), 'For the draft')

  await Promise.all([page.waitForEvent('framedetached', { predicate: frame => frame === proposalApp }),
    rm(linkFile)])
  assert.equal(page.url(), canvasUrl)
  assert.equal(await originalApp.getByRole('textbox', { name: 'Notes' }).inputValue(), '')
  assert.equal(await page.getByRole('button', { name: 'Interact with Proposal' }).count(), 0)

  await publishLink()
  await page.goto(proposal + workspace + new URL(canvasUrl).hash)
  await pairedApps(proposal, original)
  assert.equal(new URL(page.url()).origin, proposal)

  await rm(linkFile)
  await page.goto(canvasUrl)
  await frame.getByRole('dialog', { name: 'Edit details' }).waitFor()
  assert.equal(await frame.locator('body').evaluate(() => location.search), '?state=open')
  assert.equal(page.frames().some(frame => frameUrl(frame).origin === proposal), false)
  assert.equal((await fetch(original + mapUrl).then(r => r.json())).comparison, null)
  const map = await fetch(original + mapUrl).then(r => r.json())
  map.variants = ['brief', 'detail'].map(id => ({
    id, label: 'Report ' + id, anchor: base.id, origin: proposal, route: '/records?report=' + id,
  }))
  await writeFile(join(directory, 'map.json'), JSON.stringify(map))
  await page.goto(original + workspace + '#context=1&frame=records&page=%2Frecords&view=canvas&variant=detail')
  await page.reload()
  const variant = page.locator('[data-variant="detail"]')
  await variant.getByRole('button', { name: 'Interact with Report detail' }).click()
  const variantApp = variant.frameLocator('iframe')
  await variantApp.getByRole('button', { name: 'Details' }).click()
  await variantApp.getByRole('dialog').waitFor()
  assert.equal(await variantApp.locator('body').evaluate(() => location.search), '?report=detail')
  assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('variant'), 'detail')
  const bounds = await Promise.all(['[data-frame="records"]', '[data-variant="brief"]',
    '[data-variant="detail"]', '[data-frame="details"]'].map(selector => page.locator(selector).boundingBox()))
  for (let i = 1; i < bounds.length; i++) assert.ok(bounds[i].x > bounds[i - 1].x + bounds[i - 1].width)
  assert.ok(bounds[2].x >= 0 && bounds[2].x + bounds[2].width <= page.viewportSize().width)
  await panOverApp(variantApp.getByRole('textbox', { name: 'Notes' }), '[data-variant="detail"]', 'active Reports variant')
  assert.ok(await variantApp.getByRole('dialog').isVisible())
  await page.goto(original + workspace + '#context=1&frame=records&page=%2Frecords&view=canvas&variant=brief')
  await page.waitForFunction(() => {
    const brief = document.querySelector('[data-variant="brief"]').getBoundingClientRect()
    return brief.left >= 0 && brief.right <= innerWidth
  })
  assert.deepEqual(errors, [])
})
