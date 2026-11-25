// Verify the three demonstrated Tasks operations before retiring their previews.
// The caller must choose an isolated studio whose candidate already contains the native edits.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'
import { candidateHandoff, helperResult } from '../../../scripts/proposal-journal.mjs'
import { acceptProposal } from '../../../scripts/proposal.mjs'
import { port } from './hosts.mjs'

const dir = resolve(process.argv[2]),
  studio = JSON.parse(await readFile(join(dir, 'studio.json'), 'utf8'))
const [original, design, sibling] = studio.versions
assert.equal(design.id, 'a')
process.env.INSPECTOR_HELPER_PORT = String(studio.helperPort)
const handoff = candidateHandoff(design.directory)
const expected = new Map([
  ['component-icon', 'download'],
  ['component-variant', 'secondary'],
  ['gap', 'var(--space-6)'],
])
assert.deepEqual(
  new Map(handoff.operations.flatMap((o) => o.changes.map((c) => [c.property, c.requested]))),
  expected,
)
assert.equal(handoff.operations.length, 3)
const browser = await chromium.launch()
const state = await mkdtemp(join(tmpdir(), 'studio-native-'))
async function native(version, chosen) {
  const n = await port()
  const server = spawn(
    process.execPath,
    [
      join(version.app, 'node_modules/vite/bin/vite.js'),
      '--host',
      '127.0.0.1',
      '--port',
      String(n),
      '--strictPort',
    ],
    { cwd: version.app, stdio: ['ignore', 'pipe', 'inherit'] },
  )
  const done = once(server, 'exit')
  try {
    await Promise.race([
      new Promise((res) =>
        server.stdout.on('data', (d) => {
          if (String(d).includes('127.0.0.1:')) res()
        }),
      ),
      done.then(() => {
        throw Error('Ordinary Vite exited early')
      }),
    ])
    const page = await browser.newPage({ viewport: { width: 1480, height: 1000 } })
    await page.goto('http://127.0.0.1:' + n + '/tasks')
    const rows = page.locator('tbody .w-25')
    await rows.first().waitFor()
    const gaps = (loc) =>
      loc.evaluateAll((ns) => ns.map((n) => [getComputedStyle(n).rowGap, getComputedStyle(n).columnGap]))
    const paints = await gaps(rows)
    assert.ok(
      paints.length > 1 && paints.flat().every((v) => v === (chosen ? '24px' : '8px')),
      JSON.stringify(paints),
    )
    const neighbor = await gaps(page.locator('tbody td .flex.items-center.gap-2:not(.w-25)'))
    assert.ok(neighbor.length && neighbor.flat().every((v) => v === '8px'))
    const imp = page.getByRole('button', { name: 'Import', exact: true }),
      create = page.getByRole('button', { name: 'Create', exact: true })
    const color = await imp.evaluate((n) => getComputedStyle(n).backgroundColor)
    assert.equal(await imp.evaluate((n) => n.classList.contains('bg-secondary')), chosen)
    assert.equal(await create.locator('svg.lucide-' + (chosen ? 'download' : 'plus')).count(), 1)
    assert.equal(
      await page
        .locator('[data-li-contract],[data-li-revision],#localhost-inspector,[data-inspector-instance]')
        .count(),
      0,
    )
    assert.equal(
      await page.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .some((e) => e.name.includes('virtual:inspector') || e.name.includes('/__inspector-flow/')),
      ),
      false,
    )
    for (const button of [imp, create]) {
      await button.click()
      await page.getByRole('dialog').waitFor()
      await page.keyboard.press('Escape')
    }
    console.log(
      version.label,
      'native rows',
      paints.length,
      'Status',
      paints[0],
      'Import',
      color,
      'both dialogs opened',
    )
    await page.close()
    return color
  } finally {
    server.kill()
    await done
  }
}
try {
  const base = await native(original, false)
  assert.equal(await native(sibling, false), base)
  const paint = await native(design, true)
  assert.notEqual(paint, base)
  const report = join(state, 'verified.json')
  await writeFile(
    report,
    JSON.stringify({
      projectId: handoff.project.id,
      revision: handoff.revision,
      verified: handoff.operations.map((o) => ({
        id: o.id,
        summary:
          'Verified in native Vite without Inspector: both Status axes 24px, Priority 8px, Import paint ' +
          paint +
          ', Create renders Download, both dialogs open. Original and sibling retained their initial paint, slot and spacing.',
      })),
    }),
  )
  helperResult(join(dir, 'helper'), 'complete', String(design.port), report)
  assert.equal(candidateHandoff(design.directory).operations.length, 0)
  assert.equal((await acceptProposal(design.directory)).status, 'accepted')
  assert.equal(await native(original, true), paint)
  assert.equal(await native(sibling, false), base)
} finally {
  await browser.close()
}
