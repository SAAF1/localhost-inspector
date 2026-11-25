// Run after bookshelf.mjs has saved its token choice in disposable Design A.
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openStudio } from '../../../scripts/studio-browser.mjs'
import { candidateHandoff } from '../../../scripts/proposal-journal.mjs'
import { installedControls } from './installed-controls.mjs'

const { page, context, worker, version } = await openStudio(resolve(process.argv[2]), {
  id: 'a',
  route: '/',
  headless: true,
  profile: await mkdtemp(join(tmpdir(), 'bookshelf-observed-')),
})
const { panel } = installedControls(page, worker)
const cards = page.frameLocator('#app-preview').locator('article.book-card')
const values = () => cards.evaluateAll((nodes) => nodes.map((n) => getComputedStyle(n).gap))
const original = candidateHandoff(version.directory)
try {
  const [operation] = original.operations
  assert.equal(original.operations.length, 1)
  assert.equal(operation.changes[0].requested, 'var(--space-8)')
  await cards.first().waitFor()
  await cards
    .first()
    .locator('.card-text p')
    .click({ modifiers: ['Meta'] })
  await panel('#edits-tab')
  const row = '.li-pending-open[data-edit-id="' + operation.id + '"]'
  await panel(row, 'Previewing')
  const baseline = await values()
  assert.ok(baseline.length >= 2 && baseline.every((value) => value === '32px'))
  // Controlled counterexample: the first target and its source revision still
  // match. A different, mounted instance now paints a stronger app declaration.
  const peer = cards.nth(1)
  const previous = await peer.getAttribute('style')
  try {
    await peer.evaluate((node) => node.style.setProperty('gap', '7px', 'important'))
    await panel('#design-tab')
    await panel('#edits-tab')
    await panel(row, 'Effect missing')
    const actual = await values()
    assert.equal(actual[1], '7px')
    assert.deepEqual(
      actual.filter((_, i) => i !== 1),
      baseline.filter((_, i) => i !== 1),
    )
    await panel('#pending-status[data-error]', 'couldn’t be applied', false)
  } finally {
    await peer.evaluate((node, style) => {
      if (style === null) node.removeAttribute('style')
      else node.setAttribute('style', style)
    }, previous)
  }
  await panel('#design-tab')
  await panel('#edits-tab')
  await panel(row, 'Previewing')
  assert.deepEqual(await values(), baseline)
  assert.equal(candidateHandoff(version.directory).revision, original.revision)
  console.log(
    'PASS visible peer defeats one shared declaration; row reports missing effect, then recovers without changing the journal.',
  )
} finally {
  await context.close()
}
