import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { chromium } from 'playwright'
import { host, port } from './hosts.mjs'
import { candidateHandoff, helperResult } from '../../../scripts/proposal-journal.mjs'
const root = resolve(process.argv[2]),
  studio = JSON.parse(await readFile(join(root, 'studio.json'), 'utf8'))
const version = studio.versions.find((v) => v.id === (process.argv[3] || 'b'))
assert.notEqual(version.id, 'original')
const handoff = candidateHandoff(version.directory)
assert.equal(handoff.operations.length, 1)
const changes = handoff.operations[0].changes
assert.deepEqual(changes.map((c) => c.property).sort(), ['padding-left', 'padding-right'])
assert.ok(changes.every((c) => c.requested === '28px' && c.prepared.file === 'src/App.tsx'))
const path = join(version.app, changes[0].prepared.file),
  src = await readFile(path, 'utf8')
const manifest = JSON.parse(await readFile(join(version.directory, 'prepared.json'), 'utf8'))
const original = manifest.sites.find((s) => s.id === changes[0].prepared.site).opening
assert.equal(src.split(original).length, 2)
assert.ok(original.includes('px-[16px]') && original.includes('onNext'))
await writeFile(path, src.replace(original, original.replace('px-[16px]', 'px-[28px]')))
const b = await chromium.launch()
try {
  for (const v of [studio.versions[0], version]) {
    const server = await host(v.app, '', '', await port(), true)
    try {
      const p = await b.newPage()
      await p.goto(server.origin)
      const next = p.getByRole('button', { name: 'Next', exact: true }),
        back = p.getByRole('button', { name: 'Back', exact: true })
      const padding = (n) =>
        n.evaluate((n) =>
          ['paddingLeft', 'paddingRight', 'paddingTop', 'paddingBottom'].map((k) => getComputedStyle(n)[k]),
        )
      const baseline = ['16px', '16px', '0px', '0px']
      const expected = v.id === 'original' ? baseline : ['28px', '28px', '0px', '0px']
      assert.deepEqual(await padding(next), expected)
      assert.deepEqual(await padding(back), baseline)
      await next.click()
      await back.click()
      assert.deepEqual(await padding(next), expected)
      assert.deepEqual(await padding(back), baseline)
      assert.equal(await p.locator('[data-li-contract],#localhost-inspector').count(), 0)
      assert.equal(await p.evaluate(() => document.adoptedStyleSheets.length), 0)
      assert.ok(
        await p.evaluate(
          () =>
            !performance
              .getEntriesByType('resource')
              .some((e) => e.name.includes('__inspector') || e.name.includes('virtual:inspector')),
        ),
      )
      await p.close()
    } finally {
      await server.close()
    }
  }
  process.env.INSPECTOR_HELPER_PORT = String(studio.helperPort)
  const receipt = join(await mkdtemp(join(tmpdir(), 'portal-retained-')), 'verification.json')
  await writeFile(
    receipt,
    JSON.stringify({
      projectId: handoff.project.id,
      revision: handoff.revision,
      verified: [
        {
          id: handoff.operations[0].id,
          summary: 'Checked Next at 28px and Back at 16px before and after navigation in ordinary Vite.',
        },
      ],
    }),
  )
  helperResult(join(root, 'helper'), 'complete', String(version.port), receipt)
  assert.equal(candidateHandoff(version.directory).operations.length, 0)
  console.log(
    'PASS native source and navigation, one px utility retained, Back and other sides unchanged, no Inspector.',
  )
} finally {
  await b.close()
}
