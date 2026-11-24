import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
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

test('a proposal and the original open at the same filtered route and replayed state', async t => {
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
      <dialog aria-label="Edit details">Open</dialog></main>`)
    const child = spawn(process.execPath, ['scripts/flow/serve.mjs', app, String(hostPort), directory, ...switches])
    t.after(() => child.kill())
    await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(([code]) => {
      throw Error('Preview host exited ' + code)
    })])
  }
  const mapUrl = '/__inspector-flow/map.json'
  assert.equal((await fetch(original + mapUrl).then(r => r.json())).comparison, null)
  await writeFile(join(directory, 'proposal-preview.json'), JSON.stringify({ originalOrigin: original, proposalOrigin: proposal }))
  const candidateMap = await fetch(proposal + mapUrl).then(r => r.json())
  assert.equal(candidateMap.frames[0].image, undefined)
  assert.equal(candidateMap.comparison.otherOrigin, original)
  const browser = await chromium.launch({ executablePath: process.env.INSPECTOR_BROWSER })
  t.after(() => browser.close())
  const page = await browser.newPage()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  const workspace = '/__inspector-flow/'
  await page.goto(original + workspace + '?page=%2Frecords%3Fstate%3Dopen')
  const frame = page.frameLocator('#app-preview')
  await frame.getByRole('button', { name: 'Details' }).click()
  await page.waitForURL(url => new URLSearchParams(url.hash.slice(1)).get('frame') === 'details')
  assert.equal(new URL(page.url()).search, '')
  for (const [version, host] of [['Proposal', proposal], ['Original', original]]) {
    await page.getByRole('combobox', { name: 'Design version' }).selectOption(version.toLowerCase())
    await page.waitForURL(url => url.origin === host)
    await frame.getByRole('dialog', { name: 'Edit details' }).waitFor()
    await frame.getByRole('heading', { name: version }).waitFor()
    assert.equal(await frame.locator('body').evaluate(() => location.search), '?state=open')
    assert.equal(new URLSearchParams(new URL(page.url()).hash.slice(1)).get('frame'), 'details')
  }
  await page.goBack()
  await page.waitForURL(url => url.origin === proposal)
  await frame.getByRole('dialog', { name: 'Edit details' }).waitFor()
  await page.goForward()
  await page.waitForURL(url => url.origin === original)
  await frame.getByRole('dialog', { name: 'Edit details' }).waitFor()
  await rm(join(directory, 'proposal-preview.json'))
  await page.reload()
  await frame.getByRole('dialog', { name: 'Edit details' }).waitFor()
  assert.equal(await frame.locator('body').evaluate(() => location.search), '?state=open')
  await page.getByRole('combobox', { name: 'Design version' }).waitFor({ state: 'hidden' })
  assert.equal((await fetch(original + mapUrl).then(r => r.json())).comparison, null)
  assert.deepEqual(errors, [])
})
