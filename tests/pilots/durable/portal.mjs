import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openStudio } from '../../../scripts/studio-browser.mjs'
import { installedControls } from './installed-controls.mjs'
import { candidateHandoff } from '../../../scripts/proposal-journal.mjs'
const root = resolve(process.argv[2]),
  started = performance.now()
const { page, context, worker, version } = await openStudio(root, {
  id: process.argv[3] || 'a',
  route: '/',
  headless: true,
  profile: await mkdtemp(join(tmpdir(), 'portal-')),
})
const { panel, until } = installedControls(page, worker)
const f = page.frameLocator('#app-preview'),
  labels = f.locator('section label'),
  field = labels.first(),
  input = field.locator('input')
const next = f.getByRole('button', { name: 'Next', exact: true }),
  back = f.getByRole('button', { name: 'Back', exact: true })
const get = (node, key) => node.evaluate((n, k) => getComputedStyle(n).getPropertyValue(k), key)
const pair = (n) =>
  Promise.all(['padding-left', 'padding-right', 'padding-top', 'padding-bottom'].map((k) => get(n, k)))
async function edit(id, value) {
  await panel(id)
  await page.keyboard.press('Meta+a')
  await page.keyboard.type(String(value))
  await page.keyboard.press('Enter')
  await panel('#inspector-panel:not([aria-busy="true"])', '', false)
}
async function action(id) {
  await panel('#edits-tab')
  await panel(id)
  await panel('#design-tab')
}
const pick = (n) => n.click({ modifiers: ['Meta'] })
const pickField = async () => {
  await pick(field.locator('span').first())
  await panel('#parent')
  await panel('#prepared-scope', 'gap', false)
}
const pickNext = async () => {
  await pick(next)
  await panel('#prepared-scope', 'padding-left', false)
}
const gapAll = async (v) =>
  until(
    () => labels.evaluateAll((ns, v) => ns.length > 1 && ns.every((n) => getComputedStyle(n).gap === v), v),
    'shared gap ' + v,
  )
const horizontal = '[aria-label="Horizontal padding"]'
try {
  await page.setViewportSize({ width: 1920, height: 1100 })
  await f.getByText('Organization profile', { exact: true }).waitFor()
  const section = await get(f.locator('section').first(), 'padding-bottom')
  const base = await pair(next),
    neighbor = await pair(back)
  await gapAll('8px')
  await pickField()
  console.log('First useful selection ms', Math.round(performance.now() - started))
  const clock = performance.now()
  await edit('#control-gap', 18)
  await gapAll('18px')
  console.log('Edit and confirmation ms', Math.round(performance.now() - clock))
  assert.equal(await get(f.locator('section').first(), 'padding-bottom'), section)
  await page.locator('#inspector-toggle').click()
  await input.fill('benign-update-state')
  // The app has no import of this stylesheet. Detect both document reload and lost React/DOM state.
  const dead = join(version.app, 'src/unused-portal-proof.css')
  const identity = await input.evaluate((n) => n.ownerDocument.defaultView.performance.timeOrigin)
  await writeFile(dead, '.gap-\\[8px\\] {gap:999px} :root{--space-fake:9px}')
  try {
    await page.waitForTimeout(1300)
    assert.equal(await input.inputValue(), 'benign-update-state')
    assert.equal(await input.evaluate((n) => n.ownerDocument.defaultView.performance.timeOrigin), identity)
    await gapAll('18px')
  } finally {
    await unlink(dead)
  }
  const appFile = join(version.app, 'src/App.tsx')
  const originalCode = await readFile(appFile, 'utf8')
  await writeFile(appFile, originalCode + '\n// unrelated trailing comment for the live source trial\n')
  try {
    await page.waitForTimeout(1400)
    await gapAll('18px')
    console.log('Benign live JSX update', {
      documentResets: Number(
        (await input.evaluate((n) => n.ownerDocument.defaultView.performance.timeOrigin)) !== identity,
      ),
      typedState: await input.inputValue(),
    })
  } finally {
    await writeFile(appFile, originalCode)
  }
  await page.waitForTimeout(400)
  const opening = '<label className="flex flex-col gap-[8px]">'
  assert.equal(originalCode.split(opening).length, 2)
  const revisionBeforeConflict = candidateHandoff(version.directory).revision
  try {
    await writeFile(appFile, originalCode.replace(opening, opening.replace('8px', '10px')))
    await gapAll('10px')
    assert.equal(candidateHandoff(version.directory).revision, revisionBeforeConflict)
  } finally {
    await writeFile(appFile, originalCode)
  }
  await gapAll('18px')
  await next.click()
  await back.click()
  await gapAll('18px')
  await page.reload()
  await gapAll('18px')
  await pickField()
  await action('#clear')
  await gapAll('8px')
  await action('#clear')
  await gapAll('18px')
  await action('#undo')
  await gapAll('8px')
  await pickNext()
  await edit(horizontal, 28)
  const expected = ['28px', '28px', ...base.slice(2)]
  await until(async () => (await pair(next)).join() === expected.join(), 'visible preview pair')
  assert.deepEqual(await pair(back), neighbor)
  await page.reload()
  await until(async () => (await pair(next)).join() === expected.join(), 'reload pair')
  await pickNext()
  await action('#clear')
  await until(async () => (await pair(next)).join() === base.join(), 'original pair')
  await action('#clear')
  await until(async () => (await pair(next)).join() === expected.join(), 'visible preview pair')
  await action('#undo')
  await until(async () => (await pair(next)).join() === base.join(), 'original pair')
  const prior = candidateHandoff(version.directory).revision
  await worker.evaluate(() => {
    const send = self.fetch
    self.fetch = (url, options) => {
      if (options?.body) {
        const m = JSON.parse(options.body)
        if (m.type === 'savePairedPadding') {
          self.fetch = send
          return send(url, { ...options, body: JSON.stringify({ ...m, expectedRevision: 987654 }) })
        }
      }
      return send(url, options)
    }
  })
  await pickNext()
  await edit(horizontal, 31)
  await panel('#status[data-error]', '', false)
  await until(async () => (await pair(next)).join() === base.join(), 'original pair')
  assert.equal(candidateHandoff(version.directory).revision, prior)
  await page.reload()
  // A second px utility on a separate, nonreserved use.
  const footer = next.locator('../..'),
    footerBase = await pair(footer)
  assert.equal(footerBase[0], '32px')
  await pickNext()
  await panel('#parent')
  await panel('#parent')
  await edit(horizontal, 36)
  assert.deepEqual(await pair(footer), ['36px', '36px', ...footerBase.slice(2)])
  await action('#undo')
  await until(async () => (await pair(footer)).join() === footerBase.join(), 'second pair Undo')
  await pickNext()
  await edit(horizontal, 28)
  await until(async () => (await pair(next)).join() === expected.join(), 'visible preview pair')
  await page.locator('#inspector-toggle').click()
  await next.click()
  await back.click()
  await until(async () => (await pair(next)).join() === expected.join(), 'visible preview pair')
  assert.deepEqual(await pair(back), neighbor)
  console.log(
    'PASS field scope, typing, gap, compare/reload/Undo, Next and Back, paired rollback, second px utility, dead stylesheet state retained',
  )
} finally {
  await context.close()
}
