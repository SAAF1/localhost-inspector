import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { chromium } from 'playwright'

const exec = promisify(execFile)
const here = dirname(fileURLToPath(import.meta.url))
const repo = join(here, '../..')
const port = process.env.INSPECTOR_TRIAL_PORT ?? '5197'
const origin = 'http://127.0.0.1:' + port
const output = process.env.INSPECTOR_TRIAL_OUTPUT ?? await mkdtemp(join(tmpdir(), 'inspector-visual-trial-'))
console.log('TRIAL_DIRECTORY', output)
const fixture = join(output, 'app')
const state = join(output, 'state')
const profile = join(output, 'browser')
const extension = join(repo, 'extension')
const completionTrial = process.argv.includes('--completion')
await mkdir(output, { recursive: true })
await cp(join(here, 'visual-handoff-app'), fixture, { recursive: true, errorOnExist: true, force: false })
if (completionTrial) {
  const entry = join(fixture, 'index.html')
  const html = await readFile(entry, 'utf8')
  await writeFile(entry, html.replace('<div class="device-rule">', '<div class="device-rule" data-inspector-target="device-review">')
    .replace('<div class="identity-rule">', '<div class="identity-rule" data-inspector-target="identity-review">'))
}
if (process.env.INSPECTOR_TRIAL_IDENTICAL === '1') {
  const entry = join(fixture, 'index.html')
  const html = (await readFile(entry, 'utf8')).replace(/<h2>(Device|Identity) rules<\/h2>/g, '<h2>Policy rules</h2>')
  await writeFile(entry, html)
}

const helperPath = join(repo, 'local-helper.mjs')
const runHelper = async (...args) => JSON.parse((await exec(process.execPath, [helperPath, state, ...args])).stdout)
const helperMode = (mode) => exec(process.execPath, [helperPath, state, 'visual-evidence', port, mode])
const handoff = () => runHelper('handoff', port)
const app = spawn(process.execPath, ['server.mjs', port], { cwd: fixture, stdio: 'inherit' })
let helper
let context
const wait = async (predicate, label, ms = 8000) => {
  const limit = Date.now() + ms
  while (Date.now() < limit) {
    if (await predicate()) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw Error('Timed out waiting for ' + label)
}

const launch = () => chromium.launchPersistentContext(profile, {
  channel: 'chromium', headless: true, viewport: { width: 1100, height: 900 },
  args: [
    '--disable-extensions-except=' + extension, '--load-extension=' + extension,
    '--enable-unsafe-extension-debugging', '--use-mock-keychain', '--no-first-run', '--no-default-browser-check',
  ],
})

async function attach(page, worker) {
  const id = new URL(worker.url()).host
  const browserClient = await context.browser().newBrowserCDPSession()
  const { targetInfos } = await browserClient.send('Target.getTargets', { filter: [{ type: 'tab' }] })
  const tab = targetInfos.find(target => target.url === page.url())
  assert.ok(tab, 'The active fixture tab should have a browser-level target')
  await browserClient.send('Extensions.triggerAction', { id, targetId: tab.targetId })
  await browserClient.detach()
  await page.locator('#localhost-inspector').waitFor({ state: 'attached' })
}

async function reattachWithoutCapturePermission(page, worker) {
  await attach(page, worker)
  await page.goto('about:blank')
  await page.goBack()
  await page.locator('#localhost-inspector').waitFor({ state: 'attached' })
  const captureError = await worker.evaluate(async origin => {
    const [tab] = (await chrome.tabs.query({ active: true })).filter(tab => tab.url?.startsWith(origin))
    if (!tab) throw Error('No active fixture tab')
    return chrome.tabs.captureVisibleTab(tab.windowId).then(() => null, error => error.message)
  }, origin)
  assert.match(captureError ?? '', /activeTab|permission/i, 'Chrome denies capture after leaving its action grant')
}

const position = (page, worker, selector) => worker.evaluate(async ({ origin, selector }) => {
  const [tab] = (await chrome.tabs.query({ active: true })).filter(tab => tab.url?.startsWith(origin))
  if (!tab) return null
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: selector => {
      const host = document.querySelector('#localhost-inspector')
      if (!host) return null
      const node = chrome.dom.openOrClosedShadowRoot(host).querySelector(selector)
      if (!node || node.disabled) return null
      node.scrollIntoView({ block: 'nearest' })
      const { x, y, width, height } = node.getBoundingClientRect()
      return width && height ? { x: x + width / 2, y: y + height / 2 } : null
    },
    args: [selector],
  })
  return result
}, { origin, selector }).then(async point => { if (point) await page.mouse.click(point.x, point.y); return point })

async function editGap(page, worker, value, section = 'Identity') {
  await page.getByRole('button', { name: section + ' rules' }).click()
  await page.locator('.' + section.toLowerCase() + '-rule').first().click({ modifiers: ['Meta'], position: { x: 250, y: 10 } })
  const commit = () => worker.evaluate(async ({ origin, value }) => {
    const [tab] = (await chrome.tabs.query({ active: true })).filter(tab => tab.url?.startsWith(origin))
    if (!tab) return false
    const [response] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: value => {
        const root = chrome.dom.openOrClosedShadowRoot(document.querySelector('#localhost-inspector'))
        const input = root.querySelector('#control-gap')
        if (!(input instanceof HTMLInputElement) || input.disabled) return false
        input.value = String(value)
        input.dispatchEvent(new Event('change', { bubbles: true }))
        return true
      },
      args: [value],
    })
    return response.result
  }, { origin, value })
  await wait(commit, 'Gap control')
}

async function undo(page, worker) {
  await position(page, worker, '#edits-tab')
  await wait(() => position(page, worker, '#undo'), 'Undo')
  await wait(async () => (await handoff()).operations.length === 0, 'saved Undo')
}

async function testCompletion(page, worker) {
  await helperMode('on')
  await editGap(page, worker, 12)
  await wait(async () => Boolean((await handoff()).operations[0]?.visualEvidence), 'first completion image')
  const first = await handoff()
  const [verified] = first.operations
  // Separate the two commits by the evidence worker's 600 ms capture interval.
  await new Promise(resolve => setTimeout(resolve, 650))
  await editGap(page, worker, 14, 'Device')
  await wait(async () => Boolean((await handoff()).operations[1]?.visualEvidence), 'second completion image')
  const batch = await handoff()
  const pending = batch.operations[1]
  assert.equal(batch.operations.length, 2)
  assert.equal(pending.changes[0].requested, '14px')

  const source = join(fixture, 'identity.css')
  await writeFile(source, (await readFile(source, 'utf8')).replace('gap: 8px', 'gap: 12px'))
  await exec(process.execPath, [join(here, 'visual-handoff-preview-check.mjs'), port, '8px', '12px'])

  const verifiedImage = verified.visualEvidence.imagePath
  const pendingImage = pending.visualEvidence.imagePath
  const activeImages = await Promise.all([readFile(verifiedImage), readFile(pendingImage)])
  assert.ok(!activeImages[0].equals(activeImages[1]), 'each operation has its own distinct capture')
  const reportPath = join(output, 'completion.json')
  const summary = 'Verified identity.css gap in both Identity rules with Inspector off. Device rules still use 8px.'
  const complete = async (revision, ids) => {
    const report = { projectId: batch.project.id, revision, verified: ids.map(id => ({ id, summary })) }
    await writeFile(reportPath, JSON.stringify(report))
    return runHelper('complete', port, reportPath)
  }
  await assert.rejects(complete(first.revision, [verified.id]), /stale|revision|journal/i)
  await assert.rejects(complete(batch.revision, [verified.id, '00000000-0000-4000-a000-000000000000']), /operation|unknown|pending/i)
  assert.deepEqual(await handoff(), batch, 'invalid or stale reports do not modify the handoff')
  assert.deepEqual(await Promise.all([readFile(verifiedImage), readFile(pendingImage)]), activeImages)

  const result = await complete(batch.revision, [verified.id])
  assert.equal(result.revision, batch.revision + 1)
  assert.equal(result.reloadInspector, true)
  assert.deepEqual(result.imageCleanupFailed, [])
  assert.equal(result.completed.length, 1)
  assert.equal(result.completed[0].id, verified.id)
  assert.equal(result.completed[0].summary, summary)
  assert.ok(Number.isFinite(Date.parse(result.completed[0].completedAt)))
  const { journal: journalPath } = await runHelper('status')
  const journal = JSON.parse(await readFile(journalPath, 'utf8'))
  assert.deepEqual(journal.completed, result.completed, 'the text result is durable')
  assert.deepEqual((await handoff()).operations, [pending], 'only the unresolved edit stays in the handoff')
  await assert.rejects(readFile(verifiedImage), { code: 'ENOENT' })
  assert.deepEqual(await readFile(pendingImage), activeImages[1])

  await page.reload()
  await page.locator('#localhost-inspector').waitFor({ state: 'attached' })
  await wait(() => page.locator('.device-rule').first().evaluate(node => node.style.gap === '14px'), 'pending preview replay')
  await page.getByRole('button', { name: 'Identity rules' }).click()
  const identity = await page.locator('.identity-rule').evaluateAll(nodes => nodes.map(node => [getComputedStyle(node).gap, node.style.gap]))
  assert.deepEqual(identity, [['12px', ''], ['12px', '']], 'verified value comes from source after refresh')
  console.log('PASS installed mixed completion, rejected reports, selective PNG removal, and replay', output)
}

try {
  await wait(async () => fetch(origin).then(response => response.ok, () => false), 'fixture')
  await runHelper('bind', port, fixture)
  helper = spawn(process.execPath, [helperPath, state, 'serve'], { stdio: 'inherit' })
  await wait(async () => readFile(join(state, 'pairing-key')).then(() => true, () => false), 'pairing')
  context = await launch()
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
  const settings = await context.newPage()
  await settings.goto('chrome-extension://' + new URL(worker.url()).host + '/settings.html')
  if (process.env.INSPECTOR_HELPER_PORT) await settings.locator('#port').fill(process.env.INSPECTOR_HELPER_PORT)
  await settings.locator('#key').fill((await readFile(join(state, 'pairing-key'), 'utf8')).trim())
  await settings.locator('#connect').click()
  await settings.locator('#result').filter({ hasText: 'Connected' }).waitFor()
  await settings.close()
  const page = context.pages()[0] ?? await context.newPage()
  await page.goto(origin)
  await attach(page, worker)
  await wait(() => position(page, worker, '#entry'), 'Inspector launcher')

  if (completionTrial) await testCompletion(page, worker)
  else await testVisualHandoff(page, worker)
} finally {
  await context?.close()
  helper?.kill()
  app.kill()
}

async function testVisualHandoff(page, worker) {
  await editGap(page, worker, 10)
  await wait(async () => (await handoff()).operations.length === 1, 'off-edit journal')
  assert.equal((await handoff()).operations[0].visualEvidence, undefined, 'default off')
  await undo(page, worker)
  await helperMode('on')
  await editGap(page, worker, 12)
  await wait(async () => Boolean((await handoff()).operations[0]?.visualEvidence), 'evidence in handoff')
  const initial = await handoff()
  const [operation] = initial.operations
  const path = operation.visualEvidence.imagePath
  assert.ok(path.startsWith(state + '/'))
  const image = await readFile(path)
  const digest = createHash('sha256').update(image).digest('hex')
  assert.equal(image.subarray(1, 4).toString(), 'PNG')
  console.log('CAPTURED', image.readUInt32BE(16), image.readUInt32BE(20), path)

  await page.goto(origin + '/about')
  assert.equal((await handoff()).operations[0].visualEvidence.imagePath, path, 'delivery after leaving capture screen')
  await context.close()
  context = undefined
  assert.equal(createHash('sha256').update(await readFile((await handoff()).operations[0].visualEvidence.imagePath)).digest('hex'), digest, 'same image after browser close')

  // Export two copies with the same operation and source baseline. Fixture paths differ solely to isolate agent writes.
  for (const arm of ['r1', 'r2']) {
    const dir = join(output, arm)
    await mkdir(dir)
    await cp(fixture, join(dir, 'app'), { recursive: true })
    const snapshot = structuredClone(initial)
    snapshot.project.source = join(dir, 'app')
    if (arm === 'r1') {
      const { visualEvidence, ...operation } = snapshot.operations[0]
      assert.ok(visualEvidence)
      snapshot.operations[0] = operation
    } else {
      const imagePath = join(dir, 'selection.png')
      await writeFile(imagePath, image)
      snapshot.operations[0].visualEvidence.imagePath = imagePath
    }
    await writeFile(join(dir, 'handoff.json'), JSON.stringify(snapshot, null, 2) + '\n')
  }

  // A new browser connection reads the saved handoff. Here attachment is only needed to exercise Undo.
  context = await launch()
  worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker')
  page = context.pages()[0] ?? await context.newPage()
  await page.goto(origin)
  await reattachWithoutCapturePermission(page, worker)
  await wait(() => position(page, worker, '#entry'), 'Inspector launcher after restart')
  await undo(page, worker)
  assert.equal((await handoff()).operations.length, 0)
  await assert.rejects(readFile(path), { code: 'ENOENT' }, 'Undo removes the original image file')
  await editGap(page, worker, 14)
  await wait(async () => (await handoff()).operations.length === 1, 'denied-capture edit')
  const denied = await handoff()
  assert.equal(denied.operations[0].changes[0].requested, '14px', 'capture denial preserves the edit')
  assert.equal(denied.operations[0].visualEvidence, undefined, 'capture denial leaves no reference')
  await undo(page, worker)
  console.log('PASS installed browser action, crop retention, Undo and denied capture', output)
}
