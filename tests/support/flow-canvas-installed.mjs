import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { chromium } from 'playwright'

const exec = promisify(execFile)
const repo = fileURLToPath(new URL('../../', import.meta.url))
const fixture = resolve(process.argv[2] ?? '')
const port = process.env.INSPECTOR_FLOW_PORT ?? '5257'
const origin = 'http://127.0.0.1:' + port
const output = process.env.INSPECTOR_FLOW_OUTPUT ?? await mkdtemp(join(tmpdir(), 'inspector-flow-proof-'))
const state = join(output, 'state')
const map = process.env.INSPECTOR_FLOW_MAP || join(output, 'map')
const extension = join(repo, 'extension')
const children = []
let browser

function start(file, args, options, ready) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(repo, file), ...args], { ...options, stdio: ['ignore', 'pipe', 'inherit'] })
    children.push(child)
    const timeout = setTimeout(() => reject(Error('Timed out starting ' + file)), 7000)
    child.once('error', error => { clearTimeout(timeout); reject(error) })
    child.once('exit', code => { clearTimeout(timeout); reject(Error(file + ' exited: ' + code)) })
    child.stdout.on('data', data => {
      if (String(data).includes(ready)) { clearTimeout(timeout); resolve(child) }
    })
  })
}

async function action(context, page, extensionId) {
  const client = await context.browser().newBrowserCDPSession()
  try {
    const { targetInfos } = await client.send('Target.getTargets', { filter: [{ type: 'tab' }] })
    await client.send('Extensions.triggerAction', { id: extensionId,
      targetId: targetInfos.find(target => target.url === page.url()).targetId })
  } finally { await client.detach() }
}

try {
  await mkdir(output, { recursive: true })
  await start('scripts/flow/serve.mjs', [join(fixture, 'dist'), port, map], { cwd: fixture }, 'listening')
  await exec(process.execPath, [join(repo, 'local-helper.mjs'), state, 'bind', port, fixture])
  const cli = (...args) => exec(process.execPath, [join(repo, 'local-helper.mjs'), state, ...args])
  const handoff = async () => JSON.parse((await cli('handoff', port)).stdout)
  await cli('visual-evidence', port, 'on')
  const startHelper = () => start('local-helper.mjs', [state, 'serve'], { cwd: repo }, 'listening')
  const helper = await startHelper()
  if (!process.env.INSPECTOR_FLOW_MAP) {
    const { stdout } = await exec(process.execPath, [join(repo, 'scripts/flow/map.mjs'), fixture, origin, map])
    console.log(stdout.trim())
  }

  browser = await chromium.launchPersistentContext(join(output, 'chrome'), {
    headless: true, channel: 'chromium', viewport: { width: 1480, height: 1024 },
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension,
      '--enable-unsafe-extension-debugging', '--use-mock-keychain', '--no-first-run', '--no-default-browser-check'],
  })
  await browser.route('**/*', entry => {
    const url = new URL(entry.request().url())
    return url.hostname === '127.0.0.1' || url.protocol === 'chrome-extension:' ? entry.continue() : entry.abort()
  })
  const worker = browser.serviceWorkers()[0] ?? await browser.waitForEvent('serviceworker')
  const extensionId = new URL(worker.url()).host
  const settings = await browser.newPage()
  await settings.goto('chrome-extension://' + extensionId + '/settings.html')
  await settings.locator('#key').fill((await readFile(join(state, 'pairing-key'), 'utf8')).trim())
  await settings.locator('#connect').click()
  await settings.locator('#result').filter({ hasText: 'Connected' }).waitFor({ timeout: 5000 })
  await settings.close()

  const page = await browser.newPage()
  page.setDefaultTimeout(7000)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(origin + '/__inspector-flow/?page=/tasks')
  await action(browser, page, extensionId)
  const iframe = page.frameLocator('#app-preview')
  const create = iframe.getByRole('button', { name: 'Create', exact: true })
  const attached = () => page.waitForFunction(() => document.querySelector('#app-preview').dataset.inspectorDocument, null, { timeout: 6000 })
  await attached()
  const helperStopped = new Promise(resolve => helper.once('exit', resolve))
  helper.kill('SIGTERM')
  await helperStopped
  await page.reload()
  await attached()
  await page.locator('#localhost-inspector-dock #localhost-inspector').waitFor({ state: 'attached' })
  await startHelper()
  await page.reload()
  await attached()
  await create.click({ modifiers: ['Meta'] })
  await page.locator('#localhost-inspector-dock[data-inspector-open]').waitFor()
  await iframe.locator('#localhost-inspector-outlines #outline').waitFor({ state: 'visible' })
  console.log('Inspector survived a helper outage and recovered after reload without reattaching.')
  const bridge = await worker.evaluate(async origin => {
    const [tab] = await chrome.tabs.query({ url: origin + '/__inspector-flow/*' })
    const frames = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true },
      func: async () => window.frameElement?.id === 'app-preview'
        ? chrome.runtime.sendMessage({ type: 'load', route: location.pathname }) : null })
    return frames.find(frame => frame.result)?.result
  }, origin)
  assert.equal(bridge?.ok, true, JSON.stringify(bridge))
  await create.waitFor({ timeout: 6000 })
  const toggle = page.locator('#flow-toggle')
  const inspectorToggle = page.locator('#inspector-toggle')
  await inspectorToggle.click()
  assert.equal(await inspectorToggle.getAttribute('aria-expanded'), 'false')
  await inspectorToggle.click()
  assert.equal(await inspectorToggle.getAttribute('aria-expanded'), 'true')
  await toggle.click()
  const viewOptions = page.locator('#frame-view-toggle')
  await viewOptions.click()
  await page.getByRole('menuitemradio', { name: /Tablet/ }).click()
  await page.waitForFunction(() => document.querySelector('#app-preview').contentWindow.innerWidth === 768)
  await viewOptions.click()
  await page.getByRole('menuitemradio', { name: /Desktop/ }).click()
  await page.locator('#frame-view-toggle[aria-disabled="false"]').waitFor()
  // Open the closed shadow-root inspector with the trusted extension context.
  const panelPoint = async selector => worker.evaluate(async ({ origin, selector }) => {
    const [tab] = await chrome.tabs.query({ url: origin + '/__inspector-flow/*' })
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: selector => {
        const host = document.querySelector('#localhost-inspector')
        const node = host && chrome.dom.openOrClosedShadowRoot(host).querySelector(selector)
        if (!node || node.disabled || node.hidden || !node.getClientRects().length) return null
        node.scrollIntoView({ block: 'nearest' })
        const box = node.getBoundingClientRect()
        return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
      },
      args: [selector],
    })
    return result
  }, { origin, selector })
  async function panelClick(selector) {
    const expires = Date.now() + 5000
    while (Date.now() < expires) {
      const point = await panelPoint(selector)
      if (point) {
        await page.mouse.click(point.x, point.y)
        return
      }
      await new Promise(resolve => setTimeout(resolve, 35))
    }
    assert.fail('Inspector control was unavailable: ' + selector)
  }
  const createBox = await create.boundingBox()
  await page.keyboard.down('Meta')
  await page.mouse.click(createBox.x + 3, createBox.y + createBox.height / 2)
  await page.keyboard.up('Meta')
  const outlines = iframe.locator('#localhost-inspector-outlines')
  await outlines.locator('#outline').waitFor({ state: 'visible', timeout: 5000 })
  const outline = await outlines.locator('#outline').boundingBox()
  const element = await create.boundingBox()
  for (const dimension of ['x', 'y', 'width', 'height']) {
    assert.ok(Math.abs(outline[dimension] - element[dimension]) < 2, JSON.stringify({ dimension, outline, element }))
  }
  const before = await create.evaluate(node => getComputedStyle(node).paddingTop)
  await page.evaluate(() => document.querySelector('#viewport').dispatchEvent(new WheelEvent('wheel',
    { deltaY: -48, ctrlKey: true, clientX: 500, clientY: 400, cancelable: true, bubbles: true })))
  assert.notEqual(await page.locator('#zoom').textContent(), '36%')
  await panelClick('#control-padding-vertical')
  await page.keyboard.press('Meta+a')
  await page.keyboard.insertText('19')
  await page.keyboard.press('Enter')
  await create.evaluate(node => new Promise((resolve, reject) => {
    const start = performance.now()
    const time = setInterval(() => {
      if (getComputedStyle(node).paddingTop === '19px' && getComputedStyle(node).paddingBottom === '19px') { clearInterval(time); resolve() }
      else if (performance.now() - start > 4000) { clearInterval(time); reject(Error('Edit did not apply')) }
    }, 50)
  }))
  const evidenceDeadline = Date.now() + 5000
  let operation
  while (Date.now() < evidenceDeadline) {
    operation = (await handoff()).operations.find(entry => entry.changes[0].requested === '19px')
    if (operation?.visualEvidence) break
    await new Promise(resolve => setTimeout(resolve, 80))
  }
  assert.deepEqual(operation?.changes.map(change => [change.route, change.property, change.requested]), [
    ['/tasks', 'padding-top', '19px'], ['/tasks', 'padding-bottom', '19px'],
  ])
  assert.equal(operation?.changes[0].sourceContext.bounds.length, 4)
  assert.ok(operation?.visualEvidence?.imagePath, 'Expanded canvas edit should have a visual crop')
  const png = await readFile(operation.visualEvidence.imagePath)
  const appFrame = await page.locator('#app-preview').boundingBox()
  assert.ok(png.readUInt32BE(16) <= Math.ceil(appFrame.width), 'Crop cannot include neighboring frames')
  assert.ok(png.readUInt32BE(20) <= Math.ceil(appFrame.height), 'Crop cannot include neighboring frames')
  await panelClick('button[aria-label="Undo last preview"]')
  const until = Date.now() + 4000
  while (await create.evaluate(node => getComputedStyle(node).paddingTop) !== before && Date.now() < until) {
    await new Promise(resolve => setTimeout(resolve, 25))
  }
  assert.deepEqual(await create.evaluate(node => [getComputedStyle(node).paddingTop, getComputedStyle(node).paddingBottom]), [before, before])

  assert.equal((await handoff()).operations.some(entry => entry.id === operation.id), false)
  await assert.rejects(readFile(operation.visualEvidence.imagePath), { code: 'ENOENT' })
  console.log('Verified real helper edit, cropped visual evidence, and Undo on Tasks at canvas scale.')
  async function showCard(label) {
    const viewport = page.locator('#viewport')
    const card = page.locator('.flow-frame').getByText(label, { exact: true })
    const position = await card.boundingBox()
    const view = await viewport.boundingBox()
    await viewport.dispatchEvent('wheel', { deltaX: position.x - view.x - view.width / 3,
      deltaY: position.y - view.y - view.height / 3, bubbles: true, cancelable: true })
    return card
  }
  const frame = await showCard('Create')
  const began = performance.now()
  const createPhoto = frame.locator('..').locator('img')
  await createPhoto.hover()
  assert.equal(await frame.locator('..').getAttribute('aria-pressed'), 'false')
  assert.equal(await iframe.getByRole('dialog', { name: /Create Task/ }).count(), 0)
  await createPhoto.click()
  await iframe.getByRole('dialog', { name: /Create Task/ }).waitFor({ timeout: 6500 })
  await attached()
  await page.locator('#localhost-inspector-dock:not([inert])').waitFor()
  const text = iframe.getByRole('textbox', { name: 'Title' })
  await text.click({ modifiers: ['Meta'] })
  await outlines.locator('#outline').waitFor({ state: 'visible', timeout: 5000 })
  console.log('Create drawer frame selected and inspected in', Math.round(performance.now() - began), 'ms')
  const dockBox = await page.locator('#localhost-inspector-dock').boundingBox()
  assert.ok(dockBox.x + dockBox.width >= 1479, JSON.stringify(dockBox))
  const inputRadius = await text.evaluate(node => getComputedStyle(node).borderRadius)
  await panelClick('#control-border-radius')
  await page.keyboard.press('Meta+a')
  await page.keyboard.insertText('17')
  await page.keyboard.press('Enter')
  await text.evaluate(node => new Promise((resolve, reject) => {
    const limit = setTimeout(() => { clearInterval(timer); reject(Error('Drawer edit did not apply')) }, 4000)
    const timer = setInterval(() => {
      if (getComputedStyle(node).borderRadius === '17px') {
        clearTimeout(limit); clearInterval(timer); resolve()
      }
    }, 40)
  }))
  await page.screenshot({ path: join(output, 'inspecting-mapped-drawer.png') })
  await panelClick('button[aria-label="Undo last preview"]')
  await text.evaluate((node, expected) => new Promise((resolve, reject) => {
    const limit = setTimeout(() => { clearInterval(timer); reject(Error('Drawer edit did not undo')) }, 4000)
    const timer = setInterval(() => {
      if (getComputedStyle(node).borderRadius === expected) {
        clearTimeout(limit); clearInterval(timer); resolve()
      }
    }, 40)
  }), inputRadius)
  await toggle.click()
  await text.fill('unfinished task')
  assert.equal(await text.inputValue(), 'unfinished task')
  await toggle.click()
  assert.equal(await text.inputValue(), 'unfinished task')
  const priority = (await showCard('Priority')).locator('..')
  await priority.locator('img').click()
  await priority.and(page.locator('[aria-pressed="true"]')).waitFor()
  const invite = await showCard('Invite User')
  const cold = performance.now()
  await invite.click()
  const email = iframe.getByRole('textbox', { name: /email/i })
  await email.waitFor()
  await attached()
  await email.click({ modifiers: ['Meta'] })
  await outlines.locator('#outline').waitFor({ state: 'visible', timeout: 5000 })
  console.log('Cross-route Users invite selected and inspected in', Math.round(performance.now() - cold), 'ms')
  await toggle.click()
  assert.ok(await email.isVisible())
  await page.evaluate(() => {
    const extra = document.createElement('iframe')
    extra.id = 'unrelated'
    extra.src = '/users'
    extra.hidden = true
    document.body.append(extra)
  })
  await page.frameLocator('#unrelated').locator('body').waitFor({ state: 'attached' })
  const unauthorized = await worker.evaluate(async origin => {
    const [tab] = await chrome.tabs.query({ url: origin + '/__inspector-flow/*' })
    const attempts = await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true },
      func: async () => window.frameElement?.id === 'unrelated'
        ? chrome.runtime.sendMessage({ type: 'load', route: '/users' }) : null })
    return attempts.find(frame => frame.result)?.result
  }, origin)
  assert.equal(unauthorized?.ok, false)
  await page.evaluate(() => document.querySelector('#unrelated').remove())
  // An ordinary top-level application tab still follows the original attach path.
  const top = await browser.newPage()
  await top.goto(origin + '/tasks')
  await action(browser, top, extensionId)
  await top.locator('#localhost-inspector').waitFor({ state: 'attached' })
  await top.close()
  assert.deepEqual(errors, [])
  console.log('Verified scaled selection, real helper edit and Undo, mapped drawer reopening, and collapse with app state intact.')
  console.log('Trial output', output)
} finally {
  await browser?.close()
  for (const child of children.reverse()) {
    if (child.exitCode !== null || child.signalCode !== null) continue
    const exited = new Promise(resolve => child.once('exit', resolve))
    child.kill('SIGTERM')
    await exited
  }
}
