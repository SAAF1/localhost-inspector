import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { chromium } from 'playwright'

const exec = promisify(execFile)

async function availablePort() {
  const socket = createServer()
  socket.listen(0, '127.0.0.1')
  await once(socket, 'listening')
  const port = socket.address().port
  await new Promise(resolve => socket.close(resolve))
  return port
}

test('saved canvas restores frame contents across reload, new tabs, browsers and server restarts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'inspector-saved-canvas-'))
  const project = join(root, 'project')
  const capture = join(root, 'capture')
  const saved = join(root, 'saved-canvas')
  const drafts = join(root, 'creation-inputs')
  const env = { ...process.env, INSPECTOR_CANVAS_HOME: join(root, 'bindings') }
  const canvas = (...args) => exec(process.execPath, ['scripts/flow/canvas.mjs', ...args], { env })
  let browser
  let child
  async function start(port, ...mapArgs) {
    child = spawn(process.execPath, ['scripts/flow/serve.mjs', project, String(port), ...mapArgs], { env })
    await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(([code]) => {
      throw Error('Canvas server exited during startup with code ' + code)
    })])
    return 'http://127.0.0.1:' + port + '/__inspector-flow/#context=1&frame=frame-1&page=%2F&view=canvas&variant=*'
  }
  async function stop() {
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    const exit = once(child, 'exit')
    child.kill()
    await exit
  }
  async function verify(page) {
    const section = page.getByRole('region', { name: 'Project home variants', exact: true })
    await section.getByRole('heading', { name: 'Project home variants', exact: true }).waitFor()
    for (const label of ['Summary', 'Activity']) {
      const frame = section.locator('section[data-variant="' + label.toLowerCase() + '"]')
      await frame.getByRole('heading', { name: label, exact: true }).waitFor()
      if (label === 'Summary') await frame.getByText('The total comes first so you can see the change at a glance.', { exact: true }).waitFor()
      else assert.equal(await frame.locator('.frame-caption p').count(), 0)
      const content = frame.frameLocator('iframe')
      await content.getByRole('heading', { name: label + ' saved content' }).waitFor({ timeout: 5000 })
      assert.equal(await content.locator('output').textContent(), '30')
    }
    assert.equal(await page.locator('section[data-variant]').count(), 2)
  }
  try {
    await Promise.all([mkdir(project), mkdir(capture), mkdir(drafts)])
    await writeFile(join(project, 'index.html'), '<main><h1>Project home</h1><button style="margin-left:300px">Archive</button><button>Inspect record</button></main>')
    await writeFile(join(project, 'activity.html'), '<main><h1>Activity log</h1><button style="margin-left:300px">Archive</button><button>Inspect record</button></main>')
    await writeFile(join(capture, 'map.json'), JSON.stringify({
      origin: 'http://127.0.0.1:5050', viewport: { width: 900, height: 600 }, connections: [],
      frames: [{ id: 'frame-1', route: '/', label: 'Project home', heading: 'Project home', steps: [], checkpoint: [] },
        { id: 'frame-2', route: '/activity.html', label: 'Activity log', heading: 'Activity log', steps: [], checkpoint: [] }],
    }))
    await canvas('init', saved, capture)
    // Two independent creators publish frames with the same asset filenames.
    await Promise.all(['Summary', 'Activity'].map(async label => {
      const directory = join(drafts, label)
      await mkdir(join(directory, 'assets'), { recursive: true })
      await writeFile(join(directory, 'index.html'), '<main><h1></h1><output></output></main><script src="/assets/render.js"></script>')
      await writeFile(join(directory, 'assets/render.js'), 'document.querySelector("h1").textContent=' +
        JSON.stringify(label + ' saved content') + ';document.querySelector("output").textContent=new URLSearchParams(location.search).get("days")')
      await canvas('add', saved, label.toLowerCase(), 'frame-1', label, directory, '/reports?days=30',
        ...(label === 'Summary' ? ['--note', 'The total comes first so you can see the change at a glance.'] : []))
    }))
    await assert.rejects(canvas('add', saved, 'summary', 'frame-1', 'Overwritten', join(drafts, 'Activity'), '/'))
    await canvas('bind', saved, project)
    await Promise.all([rm(capture, { recursive: true }), rm(drafts, { recursive: true })])
    const hostPort = await availablePort()
    const url = await start(hostPort, saved)
    browser = await chromium.launch({ executablePath: process.env.INSPECTOR_BROWSER })
    const context = await browser.newContext({ viewport: {width:1800, height:900} })
    await context.addInitScript(() => {
      const attach = Element.prototype.attachShadow
      Element.prototype.attachShadow = function (options) {
        return attach.call(this, this.id === 'localhost-inspector' ? { ...options, mode: 'open' } : options)
      }
    })
    const first = await context.newPage()
    first.setDefaultTimeout(4000)
    await first.goto(url)
    const toggle = first.locator('#inspector-toggle')
    await toggle.click()
    await first.getByRole('button', { name: 'Variables', exact: true }).waitFor()
    await first.getByRole('tab', { name: 'Edits', exact: true }).click()
    await first.getByRole('tab', { name: 'Design', exact: true }).click()
    await first.goto(url.replace('&variant=*', ''))
    // Repeated attachment, then moving to a new document and back, must leave
    // one selection owner. Exercise both physical canvas and Layers gestures.
    for (const heading of ['Project home', 'Activity log', 'Project home']) {
      const row = first.locator('[data-outline-key="frame:' + (heading === 'Project home' ? 'frame-1' : 'frame-2') + '"] > .workspace-layer-line')
      await row.click()
      const content = first.frameLocator('#app-preview')
      await content.getByRole('heading', {name:heading, exact:true}).waitFor()
      await first.locator('#app-preview[data-inspector-document]').waitFor()
      await content.locator('body').evaluate(async () => {
        await import('/__inspector-flow/variant-runtime.mjs?attachment-retry')
      })
      const button = content.getByRole('button', { name: 'Archive', exact: true })
      const rect = await button.boundingBox()
      assert.ok(rect && rect.x >= 0 && rect.y >= 0, 'Focused frame is in view')
      await first.keyboard.down('Meta')
      try { await first.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2) }
      finally { await first.keyboard.up('Meta') }
      const tree = first.getByRole('tree', {name:'Layers'})
      await tree.getByRole('treeitem', {name:'Archive', selected:true, exact:true}).waitFor()
      const dock = first.locator('#localhost-inspector-dock')
      assert.equal(await dock.locator('#selected-name').innerText(), 'Archive')
      assert.equal(await dock.locator('#guidance').isVisible(), false)
      await tree.getByRole('treeitem', {name:'Inspect record',exact:true}).press('Enter')
      await tree.getByRole('treeitem', {name:'Inspect record', selected:true, exact:true}).waitFor()
      assert.equal(await dock.locator('#selected-name').innerText(), 'Inspect record')
    }
    // A fast user may pick a visible control while the new frame's editor is still loading.
    let releaseRuntime
    const gate = new Promise(resolve => { releaseRuntime = resolve })
    let releaseJournal
    const journalGate = new Promise(resolve => { releaseJournal = resolve })
    const journal = '**/__inspector-flow/workspace-inspector'
    await first.route(journal, async route => {
      if (route.request().postDataJSON()?.type === 'load') await journalGate
      await route.continue()
    })
    const runtime = '**/__inspector-flow/variant-runtime.mjs'
    await first.route(runtime, async route => { await gate; await route.continue() })
    try {
      await first.locator('[data-outline-key="frame:frame-2"] > .workspace-layer-line').click()
      const content = first.frameLocator('#app-preview')
      await content.getByRole('heading', {name:'Activity log', exact:true}).waitFor()
      await content.getByRole('button', {name:'Archive', exact:true}).click({ modifiers:['Meta'] })
      assert.equal(await first.locator('#app-preview[data-inspector-document]').count(), 0)
      releaseRuntime()
      const dock = first.locator('#localhost-inspector-dock')
      await dock.locator('#selected-name').filter({hasText:'Archive'}).waitFor()
      assert.ok(await dock.evaluate(node => node.inert), 'editing stays locked while the journal loads')
    } finally { releaseRuntime(); releaseJournal() }
    await first.locator('#app-preview[data-inspector-document]').waitFor()
    await first.getByRole('treeitem', {name:'Archive', selected:true, exact:true}).waitFor()
    await first.unroute(runtime)
    await first.unroute(journal)
    await first.goto(url)
    await verify(first)
    await first.reload()
    await first.getByRole('tab', {name:'Design', exact:true}).waitFor()
    await verify(first)
    const second = await context.newPage()
    await second.goto(url)
    await verify(second)
    // The open tabs must recover the new child origins without reloading the outer canvas.
    const before = await first.locator('[data-variant="summary"] iframe').getAttribute('src')
    await first.evaluate(() => { document.body.dataset.restartWitness = 'same-canvas' })
    await stop()
    const oldOrigin = createServer()
    oldOrigin.listen(Number(new URL(before).port), '127.0.0.1')
    await once(oldOrigin, 'listening')
    try {
      await start(hostPort)
      for (const page of [first, second]) {
        await page.waitForFunction(prior => document.querySelector('[data-variant="summary"] iframe').src !== prior,
          before, { timeout: 15000 })
        await verify(page)
      }
      assert.equal(await first.locator('body').getAttribute('data-restart-witness'), 'same-canvas')
    } finally { oldOrigin.close() }
    await browser.close()
    await stop()
    const reopened = await start(await availablePort())
    browser = await chromium.launch({ executablePath: process.env.INSPECTOR_BROWSER })
    const fresh = await browser.newPage()
    await fresh.goto(reopened)
    await verify(fresh)
    // An external author publishes into the open canvas. Looking at a frame
    // leaves it in Inbox; explicit feedback moves only its IDs to Recent.
    await fresh.locator('#inspector-toggle').click()
    const activity = fresh.getByRole('region', { name: 'Activity', exact: true })
    const rows = activity.getByRole('tabpanel')
    const newDraft = join(root, 'new-draft')
    await mkdir(newDraft)
    await writeFile(join(newDraft, 'index.html'), '<h1>New draft content</h1>')
    await canvas('add', saved, 'new-draft', 'frame-1', 'New draft', newDraft, '/')
    const row = rows.getByRole('button', { name: 'New draft', exact: true })
    await row.waitFor()
    await fresh.getByRole('button', { name: 'Back to localhost' }).click()
    await row.click()
    await fresh.locator('#variant-properties').waitFor()
    await fresh.frameLocator('[data-variant="new-draft"] iframe').getByRole('heading', { name: 'New draft content' }).waitFor()
    assert.equal(await row.isVisible(), true)
    await canvas('respond', saved, 'summary', 'new-draft')
    await row.waitFor({ state: 'hidden' })
    assert.deepEqual(await rows.getByRole('button').allTextContents(), ['Activity'])
    await activity.getByRole('tab', { name: 'Recent' }).click()
    assert.deepEqual((await rows.getByRole('button').allTextContents()).sort(), ['New draft', 'Summary'])
    await fresh.reload()
    await activity.getByRole('tab', { name: 'Recent' }).click()
    await rows.getByRole('button', { name: 'New draft', exact: true }).waitFor()
  } finally {
    await browser?.close()
    await stop()
    await rm(root, { recursive: true, force: true })
  }
})
