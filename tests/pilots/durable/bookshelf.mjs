import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openStudio } from '../../../scripts/studio-browser.mjs'
import { installedControls } from './installed-controls.mjs'
import { candidateHandoff } from '../../../scripts/proposal-journal.mjs'

const dir = resolve(process.argv[2]),
  start = performance.now()
const { context, page, worker, version } = await openStudio(dir, {
  id: process.argv[3] ?? 'a',
  route: '/',
  headless: true,
  profile: await mkdtemp(join(tmpdir(), 'bookshelf-cold-')),
})
const { panel, until } = installedControls(page, worker)
const f = page.frameLocator('#app-preview'),
  cards = f.locator('article.book-card'),
  header = f.locator('.topbar')
const gap = (loc) => loc.evaluate((n) => getComputedStyle(n).gap)
const padding = () => header.evaluate((n) => [getComputedStyle(n).paddingLeft, getComputedStyle(n).paddingRight])
const handoff = () => candidateHandoff(version.directory)
async function select(start, parents) {
  await start.first().click({ modifiers: ['Meta'] })
  for (let i = 0; i < parents; i++) await panel('#parent')
}
async function input(selector, value) {
  await panel(selector)
  await page.keyboard.press('Meta+a')
  await page.keyboard.type(String(value))
  await page.keyboard.press('Enter')
}
async function act(id) {
  await panel('#edits-tab')
  await panel(id)
  await panel('#design-tab')
}
async function settled() {
  await panel('#inspector-panel:not([aria-busy="true"])', '', false)
}
try {
  await page.setViewportSize({ width: 1920, height: 1000 })
  await cards.first().waitFor({ timeout: 20000 })
  console.log('Ready ms', Math.round(performance.now() - start), 'cards', await cards.count())
  if (process.argv.includes('--resume-trial')) {
    const saved = handoff().operations
    assert.equal(saved.length, 1)
    assert.equal(saved[0].changes[0].requested, 'var(--space-8)')
    await select(cards.first().locator('.card-text p'), 2)
    await act('#undo')
    await until(async () => (await gap(cards.first())) === '12px', 'Reset this proof operation')
  }
  const baseline = await gap(cards.first()),
    neighbor = await gap(f.locator('.card-text').first()),
    head = await padding()
  const selectCard = () => select(cards.first().locator('.card-text p'), 2)
  await selectCard()
  await panel('#prepared-scope', 'gap', false)
  const t = performance.now()
  await input('#control-gap', 19)
  await until(
    () => cards.evaluateAll((ns) => ns.length > 1 && ns.every((n) => getComputedStyle(n).gap === '19px')),
    'Card gap',
  )
  console.log('Gap feedback ms', Math.round(performance.now() - t))
  await settled()
  await act('#undo')
  await until(async () => (await gap(cards.first())) === baseline, 'Gap undo')
  await selectCard()
  await panel('[aria-label="Gap options"]')
  await panel('[role=menuitem]', 'Apply variable')
  await panel('[role=option]', 'space-8')
  await until(
    () => cards.evaluateAll((ns) => ns.length > 1 && ns.every((n) => getComputedStyle(n).gap === '32px')),
    'Token gap',
  )
  await settled()
  assert.equal(await gap(f.locator('.card-text').first()), neighbor)
  await cards.first().evaluate((n) => {
    const independent = document.createElement('div')
    independent.className = 'book-card'
    independent.id = 'nested-control'
    n.append(independent)
  })
  assert.equal(await gap(f.locator('#nested-control')), baseline)
  await cards.first().evaluate((n) => n.ownerDocument.documentElement.style.setProperty('--space-8', '37px'))
  assert.ok(await cards.evaluateAll((ns) => ns.every((n) => getComputedStyle(n).gap === '37px')))
  assert.equal(await gap(f.locator('#nested-control')), baseline)
  await cards.first().evaluate((n) => n.ownerDocument.documentElement.style.removeProperty('--space-8'))
  await page.reload()
  await until(async () => (await gap(cards.first())) === '32px', 'Token reload')
  await selectCard()
  await act('#clear')
  await until(async () => (await gap(cards.first())) === baseline, 'Compare original')
  await act('#clear')
  await until(async () => (await gap(cards.first())) === '32px', 'Compare preview')
  await page.locator('#inspector-toggle').click()
  await cards.first().locator('.cover-link').click()
  await f.locator('.book-overview').waitFor()
  await f.locator('.back').click()
  await until(async () => (await gap(cards.first())) === '32px', 'Remounted book cards')
  const selectHeader = () => select(f.getByRole('button', { name: 'Browse', exact: true }), 2)
  await selectHeader()
  await panel('#prepared-scope', 'padding-left', false)
  await input('[aria-label="Horizontal padding"]', 41)
  await until(async () => (await padding()).join() === '41px,41px', 'Both padding sides')
  await settled()
  await page.reload()
  await until(async () => (await padding()).join() === '41px,41px', 'Pair reload')
  await page.setViewportSize({ width: 800, height: 960 })
  await until(async () => (await padding()).every((v) => v !== '41px'), 'Conditional padding overrides base')
  await page.setViewportSize({ width: 1920, height: 1000 })
  await until(async () => (await padding()).join() === '41px,41px', 'Return to base')
  await selectHeader()
  await act('#undo')
  await until(async () => JSON.stringify(await padding()) === JSON.stringify(head), 'Atomic Undo')
  const prior = handoff().revision
  await worker.evaluate(() => {
    const send = self.fetch
    self.fetch = (url, options) => {
      if (options?.body) {
        const message = JSON.parse(options.body)
        if (message.type === 'savePairedPadding') {
          self.fetch = send
          return send(url, { ...options, body: JSON.stringify({ ...message, expectedRevision: 987654 }) })
        }
      }
      return send(url, options)
    }
  })
  await selectHeader()
  await input('[aria-label="Horizontal padding"]', 47)
  await panel('#status[data-error]', '', false)
  assert.deepEqual(await padding(), head)
  assert.equal(handoff().revision, prior)
  console.log(
    'PASS grouped save, conditional base, reload, Undo and rejected helper save. Retained operations',
    handoff().operations.map((o) => o.changes.map((c) => [c.property, c.requested])),
  )
} finally {
  await context.close()
}
