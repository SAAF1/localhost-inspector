import assert from 'node:assert/strict'
import { readFile, writeFile, unlink, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openStudio } from '../../../scripts/studio-browser.mjs'
import { installedControls } from './installed-controls.mjs'
import { candidateHandoff } from '../../../scripts/proposal-journal.mjs'
const dir = resolve(process.argv[2]),
  { context, page, worker, version } = await openStudio(dir, {
    id: 'b',
    route: '/',
    headless: true,
    profile: await mkdtemp(join(tmpdir(), 'bookshelf-update-')),
  })
const { until, panel } = installedControls(page, worker)
const f = page.frameLocator('#app-preview'),
  cards = f.locator('article.book-card')
const source = (name) => join(version.app, 'src', name)
const main = source('main.tsx'),
  extra = source('A7DiscoveryTrial.tsx'),
  css = source('components/books/books.css'),
  tokens = source('design-system/tokens.css')
const originals = new Map(
  await Promise.all([main, css, tokens].map(async (path) => [path, await readFile(path, 'utf8')])),
)
const initial = candidateHandoff(version.directory)
assert.equal(initial.operations.length, 1)
const all = (px) =>
  cards.evaluateAll((ns, v) => ns.length > 1 && ns.every((n) => getComputedStyle(n).gap === v), px)
const inventory = async () => JSON.parse(await readFile(join(version.directory, 'prepared.json'), 'utf8'))
async function confirmConflict(path, from, to, expected) {
  const changed = originals.get(path).replace(from, to)
  assert.notEqual(changed, originals.get(path))
  await writeFile(path, changed)
  await until(() => all(expected), 'Changed source did not win')
  await cards
    .first()
    .locator('.card-text p')
    .click({ modifiers: ['Meta'] })
  await panel('#status', 'prepared source changed', false)
  assert.equal(candidateHandoff(version.directory).revision, initial.revision)
  await writeFile(path, originals.get(path))
  await until(() => all('32px'), 'Exact source restoration')
}
let created = false
try {
  await until(() => all('32px'), 'Initial retained intent')
  const start = performance.now()
  await writeFile(
    extra,
    "import React from 'react';import {createRoot} from 'react-dom/client';export function NewCard(){return <div className=\"book-card\" id=\"new-source-use\"><span>New independent card</span><span>Second line</span></div>}const mount=document.createElement('aside');document.body.append(mount);createRoot(mount).render(<NewCard/>)",
    { flag: 'wx' },
  )
  created = true
  await writeFile(main, originals.get(main) + "\nimport './A7DiscoveryTrial'\n")
  await until(
    async () => (await inventory()).sites.some((s) => s.file === 'src/A7DiscoveryTrial.tsx'),
    'No new inventory record',
  )
  const added = f.locator('#new-source-use[data-li-contract]')
  await added.waitFor()
  console.log('New file to mounted prepared use ms', Math.round(performance.now() - start))
  assert.equal(await added.evaluate((n) => getComputedStyle(n).gap), '12px')
  assert.ok(await all('32px'))
  const cardRule = originals.get(css).match(/\.book-card \{[^}]*\}/)[0]
  await confirmConflict(css, cardRule, cardRule.replace('gap: var(--space-3)', 'gap: 14px'), '14px')
  await confirmConflict(tokens, '--space-8: 32px', '--space-8: 36px', '12px')
  console.log(
    'PASS new independent use, unrelated entry import, changed stylesheet and bound token definition, saved intent and restoration',
  )
} finally {
  for (const [file, text] of originals) if ((await readFile(file, 'utf8')) !== text) await writeFile(file, text)
  if (created) await unlink(extra)
  await context.close()
}
