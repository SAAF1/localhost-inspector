// Original one-book request. Use only on a disposable studio in the isolated Linux runner.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { openStudio } from '../../../scripts/studio-browser.mjs'
import { candidateHandoff } from '../../../scripts/proposal-journal.mjs'
import { installedControls } from './installed-controls.mjs'

if (process.platform !== 'linux') throw Error('Run this trial in the isolated Linux browser runner.')
const [studio, output] = process.argv.slice(2, 4).map((p) => resolve(p))
const before = process.argv[4] ?? '0px',
  after = process.argv[5] ?? '17px'
const trace = []
let context
try {
  const session = await openStudio(studio, { id: 'a', route: '/', headless: true })
  context = session.context
  const { page, worker, version } = session
  await page.setViewportSize({ width: 1920, height: 1080 })
  const { panel, until } = installedControls(page, worker)
  const frame = page.frameLocator('#app-preview')
  const cards = frame.locator('article.book-card')
  const rows = () =>
    cards.evaluateAll((nodes) =>
      nodes.map((n) => ({
        title: n.querySelector('.card-text button').textContent,
        radius: getComputedStyle(n).borderRadius,
        key: n.getAttribute('data-inspector-target'),
      })),
    )
  const original = 'Atomic Habits'
  const selected = cards.filter({ hasText: original })
  const matches = (values, radius) =>
    values.length === 6 &&
    values.filter((v) => v.title === original).length === 1 &&
    values.every((v) => v.radius === (v.title === original ? radius : '0px'))
  const verify = async (step, radius) => {
    await until(async () => matches(await rows(), radius), step)
    trace.push({ step, rows: await rows() })
  }
  async function choose() {
    await selected.locator('.card-text button').click({ modifiers: ['Meta'] })
    await panel('#parent')
    await panel('#parent')
    await panel('#authored-edit-scope', '', 'keyboard')
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await until(
      async () => (await panel('#prepared-scope', '', false)).includes('One record'),
      'Selected-record scope',
    )
  }
  async function radius(px) {
    await panel('#control-border-radius')
    await page.keyboard.press('Control+a')
    await page.keyboard.type(String(px))
    await page.keyboard.press('Enter')
  }
  await verify('original', before)
  await choose()
  await radius(parseInt(after))
  await verify('one-book radius', after)
  await panel('#edits-tab')
  await panel('.li-pending-open')
  await verify('saved inspection', after)
  await panel('#clear')
  await verify('compare before', before)
  await panel('#clear')
  await verify('compare after', after)
  await selected.locator('.cover-link').click()
  await frame.locator('.book-overview').waitFor()
  await frame.locator('.back').click()
  await verify('detail and return', after)
  await page.reload()
  await verify('reload', after)
  await panel('#edits-tab')
  await panel('#undo')
  await verify('undo', before)
  await panel('#design-tab')
  await choose()
  await radius(parseInt(after))
  await verify('request restored for acceptance', after)
  await radius(29)
  await verify('second pending value', '29px')
  await radius(parseInt(after))
  await verify('last pending value', after)
  if (process.env.INSPECTOR_RECORD_ADVERSE === '1') {
    // Disposable upstream input only. Do not modify the qualified keyed use, renderer or journal.
    const source = join(version.app, 'src/features/library/CollectionView.tsx')
    const clean = await readFile(source, 'utf8'),
      anchor = 'books={books}'
    assert.equal(clean.split(anchor).length, 2)
    try {
      for (const [step, expression, expected] of [
        [
          'reorder',
          '[...books].reverse()',
          (v) => v.length === 6 && v.at(-1).title === original && matches(v, after),
        ],
        [
          'missing',
          'books.slice(1)',
          (v) => v.length === 5 && v.every((row) => row.title !== original && row.radius === '0px'),
        ],
        [
          'duplicate',
          '[...books,books[0]]',
          (v) =>
            v.length === 7 &&
            v.filter((row) => row.title === original).length === 2 &&
            v.filter((row) => row.title === original).every((row) => row.key === null) &&
            v.every((row) => row.radius === '0px'),
        ],
      ]) {
        await writeFile(source, clean.replace(anchor, 'books={' + expression + '}'))
        await until(async () => expected(await rows()), step)
        trace.push({ step, setup: 'disposable upstream record collection', rows: await rows() })
      }
    } finally {
      await writeFile(source, clean)
    }
    await verify('unique collection restored', after)
  }
  const handoff = candidateHandoff(version.directory)
  assert.equal(handoff.operations.length, 1)
  const [op] = handoff.operations
  assert.equal(op.status, 'pending')
  assert.equal(op.scope, 'selected-record')
  assert.equal(op.changes[0].recordScope.value, 'atomic-habits')
  trace.push({ step: 'source handoff', op })
} catch (error) {
  trace.push({ error: error.stack })
  process.exitCode = 1
} finally {
  await context?.close()
  await writeFile(output, JSON.stringify(trace, null, 2))
}
