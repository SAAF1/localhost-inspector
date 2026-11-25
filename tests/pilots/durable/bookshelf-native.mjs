// Reproduce the reviewed human/AI source handoff for the Bookshelf trial.
// This fixture-specific source diff is deliberately separate from discovery.
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { host, port } from './hosts.mjs'
import { candidateHandoff, helperResult } from '../../../scripts/proposal-journal.mjs'
const dir = resolve(process.argv[2]),
  studio = JSON.parse(await readFile(join(dir, 'studio.json'), 'utf8'))
const [original, designA, retained] = studio.versions
assert.equal(retained.id, 'b')
const handoff = candidateHandoff(retained.directory)
assert.equal(handoff.operations.length, 1)
const op = handoff.operations[0],
  change = op.changes[0]
assert.equal(change.property, 'gap')
assert.equal(change.requested, 'var(--space-8)')
assert.equal(change.prepared.file, 'src/components/books/BookCard.tsx')
const cssFile = join(retained.app, 'src/components/books/books.css'),
  componentFile = join(retained.app, change.prepared.file)
const css = await readFile(cssFile, 'utf8'),
  component = await readFile(componentFile, 'utf8')
const opening = '<article className="book-card">',
  rule = css.match(/\.book-card \{[^}]*\}/)?.[0]
assert.equal(component.split(opening).length, 2)
assert.ok(rule?.includes('gap: var(--space-3)'))
const browser = await chromium.launch(),
  servers = []
async function clean(version) {
  const server = await host(version.app, '', '', await port(), true)
  servers.push(server)
  return server.origin
}
async function observation(origin, width, clean = false) {
  const page = await browser.newPage({ viewport: { width, height: 960 } })
  const t = performance.now()
  await page.goto(origin)
  await page.locator('article.book-card').first().waitFor()
  const state = await page.evaluate(() => {
    const screen = (selector) => {
      const n = document.querySelector(selector),
        s = getComputedStyle(n)
      return [n.className, s.gap, s.width, s.paddingLeft, s.paddingRight, s.paddingTop, s.paddingBottom]
    }
    return {
      cards: [...document.querySelectorAll('article.book-card')].map((n) => getComputedStyle(n).gap),
      header: screen('.topbar'),
      inner: screen('.card-text'),
      mini: screen('.mini-book'),
    }
  })
  if (clean) {
    assert.equal(await page.locator('[data-li-contract],[data-li-revision],#localhost-inspector').count(), 0)
    assert.ok(
      !(await page.evaluate(
        () =>
          document.adoptedStyleSheets.length ||
          performance
            .getEntriesByType('resource')
            .some((e) => e.name.includes('virtual:inspector') || e.name.includes('/__inspector-flow/')),
      )),
    )
  }
  console.log(
    width,
    clean ? 'ordinary' : 'prepared',
    'first usable observation ms',
    Math.round(performance.now() - t),
  )
  await page.close()
  return state
}
try {
  const baseline = await clean(original)
  for (const width of [1440, 800, 600]) {
    assert.deepEqual(await observation(original.origin, width), await observation(baseline, width, true))
  }
  await writeFile(componentFile, component.replace(opening, '<article className="book-card library-book-card">'))
  await writeFile(
    cssFile,
    css.replace(rule, rule + '\n.book-card:where(.library-book-card) {\n  gap: var(--space-8);\n}'),
  )
  const ordinary = await clean(retained)
  for (const width of [1440, 800, 600]) {
    const originalState = await observation(baseline, width, true),
      next = await observation(ordinary, width, true)
    assert.ok(next.cards.length > 1 && next.cards.every((v) => v === '32px'))
    assert.deepEqual({ ...next, cards: originalState.cards }, originalState)
  }
  const p = await browser.newPage()
  await p.goto(ordinary)
  await p.locator('.cover-link').first().click()
  await p.locator('.book-overview').waitFor()
  await p.locator('.back').click()
  await p.locator('.book-card').first().waitFor()
  await p.evaluate(() => {
    const card = document.querySelector('article.book-card')
    const independent = document.createElement('div')
    independent.className = 'book-card'
    card.append(independent)
    document.documentElement.style.setProperty('--space-8', '37px')
  })
  assert.equal(
    await p
      .locator('article.book-card')
      .first()
      .evaluate((n) => getComputedStyle(n).gap),
    '37px',
  )
  assert.equal(await p.locator('article.book-card .book-card').evaluate((n) => getComputedStyle(n).gap), '12px')
  process.env.INSPECTOR_HELPER_PORT = String(studio.helperPort)
  const report = join(await mkdtemp(join(tmpdir(), 'bookshelf-verification-')), 'report.json')
  await writeFile(
    report,
    JSON.stringify({
      projectId: handoff.project.id,
      revision: handoff.revision,
      verified: [
        {
          id: op.id,
          summary:
            'Verified native book-card gap token after normal detail navigation, three viewport sizes, a theme token change, independent and nested consumers, with Inspector absent.',
        },
      ],
    }),
  )
  helperResult(join(dir, 'helper'), 'complete', String(retained.port), report)
  assert.equal(candidateHandoff(retained.directory).operations.length, 0)
  assert.equal(candidateHandoff(designA.directory).operations.length, 1)
  console.log(
    'PASS ordinary/empty parity, clean retained scoped source, independent sibling and completion',
    op.id,
  )
} finally {
  await browser.close()
  for (const server of servers) await server.close()
}
