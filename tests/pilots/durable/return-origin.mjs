// Installed extension trial. Pass a disposable DoHabit studio and output path.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { openStudio } from '../../../scripts/studio-browser.mjs'
import { installedControls } from './installed-controls.mjs'

const [studio, evidence, id = 'a'] = process.argv.slice(2)
const config = JSON.parse(await readFile(join(studio, 'studio.json')))
const neighbor = config.versions.find(v => v.id === (id === 'a' ? 'b' : 'a'))
const { page, context, worker } = await openStudio(studio, { id, route: '/', headless: true, profile: await mkdtemp(join(studio, 'return-profile-')) })
const { panel, until } = installedControls(page, worker)
const events = []
const label = page.frameLocator('#app-preview').getByText('100% Private', { exact: true })
const rows = () => page.frameLocator('#app-preview').locator('li').evaluateAll(nodes => nodes.map(n => [
  getComputedStyle(n.querySelector('strong')).fontSize,
  getComputedStyle(n.querySelector('small')).fontSize,
]))
let step = 'initial'
try {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await label.waitFor()
  const original = await rows()
  assert.equal(original.length, 4)
  const size = original[0][0] === '20px' ? '21' : '20'
  await label.click({ modifiers: ['Meta'] })
  await panel('#design-tab')
  await panel('#control-font-size')
  await page.keyboard.press('Meta+a')
  await page.keyboard.type(size)
  await page.keyboard.press('Enter')
  await until(async () => (await rows()).every(([observed]) => observed === size + 'px'), 'Edit did not take effect')
  const expected = await rows()
  assert.deepEqual(expected.map(x => x[1]), original.map(x => x[1]))
  const saved = new URL(page.url())
  const identity = url => [url.origin, url.pathname, url.searchParams.get('editor'), url.hash]
  events.push({ step, original, expected, identity: identity(saved) })
  for (const away of ['about:blank', new URL(saved).href.replace(new URL(saved).origin, neighbor.origin)]) {
    step = 'away'
    await page.goto(away)
    if (away !== 'about:blank') {
      await label.waitFor()
      assert.ok((await rows()).every(([observed]) => observed !== size + 'px'))
    }
    assert.equal(await page.locator('#localhost-inspector').count(), 0)
    assert.equal(await page.locator('[data-inspector-document]').count(), 0)
    events.push({ step, away })
    step = 'return'
    await page.goBack()
    await label.waitFor()
    const start = Date.now()
    await until(async () => /^[0-9A-Fa-f-]{32,36}$/.test(await page.locator('#app-preview').getAttribute('data-inspector-document') ?? ''), 'Returned destination remained detached')
    await until(async () => (await rows()).every(([observed]) => observed === size + 'px'), 'Returned effect missing')
    assert.deepEqual(identity(new URL(page.url())), identity(saved))
    assert.deepEqual(await rows(), expected)
    events.push({ step, from: away, elapsedMs: Date.now() - start, observed: await rows() })
  }
  await label.click({ modifiers: ['Meta'] })
  await panel('#edits-tab')
  await panel('.li-pending-open', 'Text size')
  await panel('#edits-tab')
  await panel('#undo')
  await until(async () => JSON.stringify(await rows()) === JSON.stringify(original), 'Undo failed')
  events.push({ step: 'saved row and Undo', observed: await rows() })
  // Simulate the same address registered to a different candidate while away.
  // Keep the mutation inside this disposable studio and restore its metadata.
  step = 'reassigned candidate'
  await page.goto('about:blank')
  const bindingsFile = join(studio, 'helper', 'bindings.json')
  const raw = await readFile(bindingsFile, 'utf8')
  try {
    const bindings = JSON.parse(raw)
    bindings[saved.origin].id = crypto.randomUUID()
    await writeFile(bindingsFile, JSON.stringify(bindings))
    await page.goBack()
    await label.waitFor()
    await until(async () => worker.evaluate(async origin => {
      const [tab] = await chrome.tabs.query({ url: origin + '/__inspector-flow/*' })
      return (await chrome.action.getTitle({ tabId: tab.id })).includes('binding changed')
    }, saved.origin), 'Missing changed-binding refusal')
    assert.equal(await page.locator('#localhost-inspector').count(), 0)
    assert.equal(await page.locator('[data-inspector-document]').count(), 0)
    events.push({ step, outcome: 'refused before mount' })
  } finally { await writeFile(bindingsFile, raw) }
} catch (error) {
  events.push({ step, failed: error.message, url: page.url(), observed: await rows().catch(() => null) })
  process.exitCode = 1
} finally {
  await writeFile(evidence, JSON.stringify(events, null, 2))
  await context.close()
}
