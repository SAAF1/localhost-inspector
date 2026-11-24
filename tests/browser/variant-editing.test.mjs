import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { chromium } from 'playwright'

const exec = promisify(execFile)
const canvas = (...args) => exec(process.execPath, ['scripts/flow/canvas.mjs', ...args])

test('the variant Inspector edits, restores, undoes and reverts only the selected saved frame', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'inspector-edit-variant-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const saved = join(temp, 'saved')
  const capture = join(temp, 'capture')
  const app = join(temp, 'app')
  await Promise.all([mkdir(capture), mkdir(app)])
  // All three frames use the identical route, element ID, markup and starting style.
  await writeFile(join(app, 'index.html'), `<main><h1>Overview</h1>
    <button id="report-action" style="border-radius:4px">Review</button></main>`)
  await writeFile(join(capture, 'map.json'), JSON.stringify({ origin: 'http://127.0.0.1:5090',
    frames: [{ id: 'frame-1', route: '/', label: 'Overview', heading: 'Overview', steps: [], checkpoint: [] }],
    connections: [], viewport: { width: 900, height: 600 },
  }))
  await canvas('init', saved, capture)
  await Promise.all(['summary', 'activity'].map(id => canvas('add', saved, id, 'frame-1', id, app, '/', '--section', 'Review alternatives')))
  const listener = createServer()
  listener.listen(0, '127.0.0.1')
  await once(listener, 'listening')
  const port = listener.address().port
  await new Promise(resolve => listener.close(resolve))
  const host = spawn(process.execPath, ['scripts/flow/serve.mjs', app, String(port), saved])
  t.after(() => host.kill())
  await Promise.race([once(host.stdout, 'data'), once(host, 'exit').then(([code]) => {
    throw Error('Saved canvas failed to start: ' + code)
  })])
  const browser = await chromium.launch({ executablePath: process.env.INSPECTOR_BROWSER })
  t.after(() => browser.close())
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  page.setDefaultTimeout(6000)
  // Expose the real Inspector's closed shadow root to Playwright locators only.
  await page.addInitScript(() => {
    const attach = Element.prototype.attachShadow
    Element.prototype.attachShadow = function (options) {
      return attach.call(this, this.id === 'localhost-inspector' ? { ...options, mode: 'open' } : options)
    }
  })
  const url = 'http://127.0.0.1:' + port + '/__inspector-flow/#context=1&frame=frame-1&page=%2F&view=canvas&variant='
  const frame = id => page.frameLocator('[data-variant="' + id + '"] iframe')
  const properties = page.frameLocator('iframe[title="Variant properties"]')
  const tree = page.frameLocator('iframe[title="Variant layers"]').getByRole('tree', { name: 'Layers' })
  const radius = target => target.locator('#report-action').evaluate(node => getComputedStyle(node).borderTopLeftRadius)
  const original = page.frameLocator('#app-preview')
  async function activate(id) {
    await page.goto(url + id)
    await page.getByRole('region', { name: 'Review alternatives' }).locator('[data-variant="' + id + '"]').waitFor()
    const control = frame(id).getByRole('button', { name: 'Review' })
    await control.waitFor()
    // The app can render before the canvas finishes centering a deep link.
    // Aim through the cover once the actual control is under it.
    const cover = page.getByRole('button', { name: 'Interact with ' + id, exact: true })
    const box = await control.boundingBox()
    const wrapperBox = await cover.boundingBox()
    const position = { x: (box.x + box.width / 2 - wrapperBox.x) / wrapperBox.width,
      y: (box.y + box.height / 2 - wrapperBox.y) / wrapperBox.height }
    await page.waitForFunction(({ id, position }) => {
      const cover = document.querySelector('[data-variant="' + CSS.escape(id) + '"] > button')
      const bounds = cover?.getBoundingClientRect()
      return bounds && document.elementFromPoint(bounds.left + bounds.width * position.x,
        bounds.top + bounds.height * position.y) === cover
    }, { id, position })
    const target = await control.boundingBox()
    await page.keyboard.down('Meta')
    try { await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2) }
    finally { await page.keyboard.up('Meta') }
    const draft = tree.getByRole('treeitem', { name: id, exact: true })
    const row = draft.getByRole('treeitem', { name: 'Review', selected: true, exact: true })
    await row.waitFor()
    // Also select from Layers and verify the right panel follows.
    await draft.getByRole('treeitem', { name: 'Overview', exact: true }).press('Enter')
    await draft.getByRole('treeitem', { name: 'Review', exact: true }).press('Enter')
    await properties.getByRole('spinbutton', { name: 'Corner radius', exact: true }).waitFor()
  }
  async function setRadius(value, count) {
    const input = properties.getByRole('spinbutton', { name: 'Corner radius', exact: true })
    await input.fill(String(value))
    await input.press('Enter')
    await properties.getByRole('tab', { name: 'Edits ' + count, exact: true }).waitFor()
  }
  await activate('summary')
  await page.keyboard.down('Meta')
  try {
    await frame('summary').getByRole('heading', { name: 'Overview' }).hover()
    const hovered = tree.locator('[data-hovered][aria-label="Overview"]')
    await hovered.waitFor()
    assert.equal(await hovered.getAttribute('aria-selected'), 'false')
  } finally { await page.keyboard.up('Meta') }
  await tree.locator('[data-hovered]').waitFor({ state: 'hidden' })
  await setRadius(18, 1)
  assert.equal(await radius(frame('summary')), '18px')
  assert.equal(await radius(frame('activity')), '4px')
  assert.equal(await radius(original), '4px')
  await page.reload()
  await activate('summary')
  await properties.getByRole('tab', { name: 'Edits 1', exact: true }).waitFor()
  assert.equal(await radius(frame('summary')), '18px')
  await activate('activity')
  await setRadius(10, 1)
  await activate('summary')
  await setRadius(24, 2)
  await properties.getByRole('tab', { name: /^Edits/ }).click()
  await properties.getByRole('button', { name: 'Undo last preview' }).click()
  await properties.getByRole('tab', { name: 'Edits 1', exact: true }).waitFor()
  assert.equal(await radius(frame('summary')), '18px')
  await properties.getByRole('button', { name: 'Revert all previews' }).click()
  await properties.getByRole('button', { name: 'Revert all', exact: true }).click()
  await properties.getByRole('tab', { name: 'Edits', exact: true }).waitFor()
  assert.equal(await radius(frame('summary')), '4px')
  await page.reload()
  await activate('activity')
  assert.equal(await radius(frame('summary')), '4px')
  assert.equal(await radius(frame('activity')), '10px')
  assert.equal(await radius(original), '4px')
})
