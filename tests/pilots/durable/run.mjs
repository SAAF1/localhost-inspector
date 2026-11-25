// Run with a local, dependency-installed shadcn-admin checkout as the sole argument.
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, readFile, writeFile, readdir, symlink, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, basename } from 'node:path'
import { chromium } from 'playwright'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { canvas, editor, host, port } from './hosts.mjs'
import { queue, transfer } from './contracts.mjs'

const source = resolve(process.argv[2])
const root = await realpath(await mkdtemp(join(tmpdir(), 'durable-inspector-')))
console.log('Trial directory', root)
const browser = await chromium.launch()
const servers = []
async function start(...args) {
  const server = await host(...args)
  servers.push(server)
  return server
}
async function prepare(id, sites, real = false) {
  const app = join(root, id),
    map = join(root, id + '-map'),
    manifest = join(root, id + '.json')
  const since = performance.now()
  await mkdir(app)
  if (real)
    await cp(source, app, {
      recursive: true,
      filter: (path) => !['.git', 'node_modules', 'dist'].includes(basename(path)),
    })
  else {
    for (const name of ['Rows.jsx', 'theme.css']) await cp(new URL(name, import.meta.url), join(app, name))
    await writeFile(join(app, 'package.json'), '{"type":"module"}')
    await writeFile(
      join(app, 'index.html'),
      '<meta charset="utf-8"><div id="root"></div><script type="module" src="/Rows.jsx"></script>',
    )
  }
  // Read installed packages through links, with private Vite caches in each app.
  const modules = join(app, 'node_modules')
  await mkdir(modules)
  for (const name of await readdir(join(source, 'node_modules'))) {
    if (!name.startsWith('.') || name === '.bin')
      await symlink(join(source, 'node_modules', name), join(modules, name))
  }
  await canvas(map)
  await writeFile(manifest, JSON.stringify({ namespace: id, sites }))
  console.log(id, 'disposable setup ms', Math.round(performance.now() - since), 'contracts', sites.length)
  return { app, map, manifest }
}
async function pageAt(url, ready) {
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } })
  page.setDefaultTimeout(9000)
  page.on('pageerror', (e) => console.log('page error', e.message))
  const t = performance.now()
  await page.goto(url)
  await page.locator(ready).first().waitFor()
  console.log('navigation to usable app ms', Math.round(performance.now() - t))
  return page
}
const gaps = (locator) =>
  locator.evaluateAll((ns) => ns.map((n) => [getComputedStyle(n).rowGap, getComputedStyle(n).columnGap]))
async function expectGap(locator, n) {
  const actual = await gaps(locator)
  assert.ok(actual.length && actual.every((pair) => pair.every((v) => v === n + 'px')), JSON.stringify(actual))
}
async function warmNavigation(page, ready, label) {
  const samples = []
  for (let i = 0; i < 3; i++) {
    const start = performance.now()
    await page.reload()
    await page.locator(ready).first().waitFor()
    samples.push(Math.round(performance.now() - start))
  }
  console.log(label, 'warm navigation ms', samples.join(', '))
}
async function queueTrial() {
  const { app, map, manifest } = await prepare('queue', queue)
  const n = await port()
  const state = join(root, 'helper-state')
  const helper = fileURLToPath(new URL('../../../local-helper.mjs', import.meta.url))
  process.env.INSPECTOR_HELPER_PORT = String(await port())
  const cli = async (...args) => (await promisify(execFile)(process.execPath, [helper, state, ...args])).stdout
  let server = await start(app, map, manifest, n, true)
  const baseline = await pageAt(server.origin, 'article')
  await warmNavigation(baseline, 'article', 'ordinary queue')
  await expectGap(baseline.locator('article .part'), 8)
  assert.equal(await baseline.locator('article svg circle').count(), 2)
  await baseline.close()
  await cli('bind', String(n), app)
  await cli('register-spacing', String(n), 'theme.css', '--space-roomy')
  const service = spawn(process.execPath, [helper, state, 'serve'], { stdio: ['ignore', 'pipe', 'inherit'] })
  await Promise.race([
    once(service.stdout, 'data'),
    once(service, 'exit').then(() => {
      throw Error('Proof helper exited')
    }),
  ])
  servers.push({
    close: async () => {
      const done = once(service, 'exit')
      service.kill()
      await done
    },
  })
  await server.close()
  server = await start(app, map, manifest, n, false, state)
  let page = await pageAt(server.origin, 'article .part')
  await warmNavigation(page, 'article', 'prepared queue')
  const rows = () => page.locator('article .part'),
    actions = () => page.locator('article button')
  const click = (name) => page.getByRole('button', { name, exact: true }).click()
  let ui = await editor(page)
  const inspect = () => ui.snapshot()
  await expectGap(rows(), 8)
  assert.equal(
    (await rows().first().getAttribute('data-li-contract')) !== null,
    true,
    'expected prepared source marker',
  )
  await ui.gap(rows(), 19)
  await expectGap(rows(), 19)
  await expectGap(page.locator('aside .part'), 8)
  await click('Reverse')
  assert.equal(await page.locator('article').first().getAttribute('aria-label'), 'Review')
  await click('Scene')
  await expectGap(rows(), 19)
  await click('Density')
  await ui.action('Show original')
  await expectGap(rows(), 14)
  await ui.action('Show previews')
  await expectGap(rows(), 19)
  await ui.action('Undo last preview')
  await expectGap(rows(), 14)
  await ui.select(rows())
  await ui.panel.getByRole('button', { name: 'Gap options' }).click()
  await ui.panel.getByRole('menuitem', { name: 'Apply variable…' }).click()
  await ui.panel.getByRole('option', { name: /space-roomy/ }).click()
  await page.waitForFunction(() => getComputedStyle(document.querySelector('article .part')).gap === '24px')
  await ui.panel.locator('#inspector-panel[aria-busy="true"]').waitFor({ state: 'hidden' })
  await click('Theme')
  await expectGap(rows(), 30)
  await page.setViewportSize({ width: 680, height: 1000 })
  await expectGap(rows(), 6)
  await page.setViewportSize({ width: 1500, height: 1000 })
  await expectGap(rows(), 30)
  await ui.choice(actions(), 'Icon', 'square')
  assert.equal(await actions().locator('svg rect').count(), 1)
  assert.equal(await page.locator('aside button svg circle').count(), 1)
  await actions().first().click()
  assert.equal(await page.locator('output').first().innerText(), 'Runs 1')
  await click('Loading')
  assert.equal(await actions().locator('svg').count(), 0)
  await click('Loading')
  assert.equal(await actions().locator('svg rect').count(), 1)
  await click('Scene')
  assert.equal(await actions().locator('svg rect').count(), 2)
  assert.equal((await inspect()).edits.length, 2)
  console.log(
    'PASS repeated part, reorder, same-URL scene, live baseline, remount, comparison, theme, media, real slot, handler, lookalikes',
  )
  await page.close()
  await server.close()
  server = await start(app, map, manifest, n, false, state)
  page = await pageAt(server.origin, 'article')
  ui = await editor(page)
  await expectGap(rows(), 24)
  assert.equal(await actions().locator('svg rect').count(), 2)
  const candidate = await prepare('candidate', queue)
  const alt = await start(candidate.app, candidate.map, candidate.manifest, await port())
  const other = await pageAt(alt.origin, 'article')
  const otherUI = await editor(other)
  assert.equal((await otherUI.snapshot()).edits.length, 0)
  await expectGap(other.locator('article .part'), 8)
  await otherUI.gap(other.locator('article .part'), 23)
  await expectGap(rows(), 24)
  await expectGap(other.locator('article .part'), 23)
  await other.close()
  await alt.close()
  await ui.action('Undo last preview')
  assert.equal(await actions().locator('svg circle').count(), 2)
  // Reject one actual journal write at the HTTP boundary.
  await page.route('**/workspace-inspector', async (route) => {
    if (route.request().postDataJSON()?.type === 'save')
      await route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ ok: false, code: 'WRITE_REJECTED', error: 'Trial rejected save' }),
      })
    else await route.continue()
  })
  await ui.choice(actions(), 'Icon', 'square')
  assert.equal(await actions().locator('svg circle').count(), 2)
  await expectGap(rows(), 24)
  assert.equal((await inspect()).edits.length, 1)
  await page.unroute('**/workspace-inspector')
  console.log(
    'PASS cold browser and server restart, independent candidate write, Undo and rejected write rollback',
  )
  const file = join(app, 'Rows.jsx'),
    initial = await readFile(file, 'utf8')
  async function restartWith(code) {
    await page.close()
    await server.close()
    await writeFile(file, code)
    server = await start(app, map, manifest, n, false, state)
    page = await pageAt(server.origin, 'article')
    ui = await editor(page)
  }
  await restartWith(initial + '\n// Independent module note\n')
  await expectGap(rows(), 24)
  await restartWith(initial.replace('wide ? 14 : 8', 'wide ? 14 : 10'))
  await expectGap(rows(), 10)
  assert.equal((await inspect()).edits.length, 1)
  assert.match(await ui.panel.locator('#status').innerText(), /prepared source changed/i)
  await restartWith(initial)
  const snapshot = await inspect()
  const handoff = JSON.parse(await cli('handoff', String(n)))
  const [op] = handoff.operations
  assert.equal(snapshot.revision, handoff.revision)
  assert.equal(op.status, 'pending')
  assert.equal(op.changes[0].spacingToken.name, '--space-roomy')
  assert.equal(op.changes[0].prepared.file, 'Rows.jsx')
  await page.close()
  await server.close()
  await writeFile(file, initial.replace('wide ? 14 : 8', "'var(--space-roomy)'"))
  server = await start(app, map, manifest, n, true)
  page = await pageAt(server.origin, 'article')
  assert.equal(await page.locator('[data-li-revision],#localhost-inspector,[data-inspector-instance]').count(), 0)
  assert.equal(await page.evaluate(() => document.adoptedStyleSheets.length), 0)
  await expectGap(rows(), 24)
  await expectGap(page.locator('aside .part'), 8)
  await click('Theme')
  await expectGap(rows(), 30)
  await click('Scene')
  await expectGap(rows(), 30)
  assert.equal(await actions().locator('svg circle').count(), 1)
  const report = join(root, 'verified.json')
  await writeFile(
    report,
    JSON.stringify({
      projectId: handoff.project.id,
      revision: handoff.revision,
      verified: [
        {
          id: op.id,
          summary:
            'Both gap axes follow the retained token in the normal app, including after a theme and scene change. The unrelated part remains 8px.',
        },
      ],
    }),
  )
  await cli('complete', String(n), report)
  assert.equal(JSON.parse(await cli('handoff', String(n))).operations.length, 0)
  console.log(
    'PASS source freshness, conflict, exported operation',
    op.id,
    'clean-source retained token and normal slot',
  )
  await page.close()
  await server.close()
}
async function transferTrial() {
  const { app, map, manifest } = await prepare('shadcn', transfer, true)
  const n = await port()
  const clean = await start(app, map, manifest, n, true)
  let page = await pageAt(clean.origin + '/tasks', 'tbody tr td')
  await warmNavigation(page, 'tbody tr td', 'ordinary Tasks')
  const statusText = await page.locator('tbody tr').first().innerText()
  const initialGap = await gaps(page.locator('tbody .w-25'))
  await page.close()
  await clean.close()
  const server = await start(app, map, manifest, n)
  page = await pageAt(server.origin + '/tasks', 'tbody tr td')
  await warmNavigation(page, 'tbody tr td', 'prepared Tasks')
  const status = page.locator('tbody .w-25'),
    priority = page.locator('tbody td .flex.items-center.gap-2').last()
  const importButton = page.getByRole('button', { name: 'Import', exact: true }),
    create = page.getByRole('button', { name: 'Create', exact: true })
  assert.equal(await page.locator('tbody tr').first().innerText(), statusText)
  assert.deepEqual(await gaps(status), initialGap)
  const ui = await editor(page)
  await ui.gap(status, 18)
  await expectGap(status, 18)
  await expectGap(priority, 8)
  await ui.panel.locator('#close-inspector').click()
  await page.getByRole('button', { name: 'Go to next page' }).press('Enter')
  await page.waitForFunction((original) => document.querySelector('tbody tr')?.innerText !== original, statusText)
  await expectGap(status, 18)
  await expectGap(priority, 8)
  const background = () => importButton.evaluate((n) => getComputedStyle(n).backgroundColor)
  const before = await background()
  await ui.choice(importButton, 'Variant', 'secondary')
  await page.mouse.move(0, 0)
  await page.waitForTimeout(400)
  assert.notEqual(await background(), before)
  await ui.panel.locator('#close-inspector').click()
  await importButton.click()
  await page.getByRole('dialog').waitFor()
  await page.keyboard.press('Escape')
  await ui.choice(create, 'Icon', 'download')
  assert.equal(await create.locator('svg.lucide-download').count(), 1)
  await ui.panel.locator('#close-inspector').click()
  await create.click()
  await page.getByRole('dialog').waitFor()
  await page.keyboard.press('Escape')
  await page.reload()
  await page.locator('tbody tr').first().waitFor()
  await editor(page)
  await expectGap(status, 18)
  await expectGap(priority, 8)
  assert.equal(await create.locator('svg.lucide-download').count(), 1)
  console.log(
    'PASS real shadcn-admin/TanStack repeated cell and lookalike, CVA variant computed paint, native Lucide slot, Import/Create dialogs, reload',
  )
  const file = join(app, transfer[2].file)
  const text = await readFile(file, 'utf8')
  const moved = text
    .replace('<span>Create</span> <Plus size={18} />', '<span>Create</span>')
    .replace('<span>Import</span>', '<Plus size={18} /><span>Import</span>')
  assert.notEqual(moved, text)
  await writeFile(file, moved)
  await page.waitForFunction(() => !document.querySelector('button[data-li-contract*="create-button"]'))
  await page.reload()
  await page.locator('tbody tr').first().waitFor()
  await editor(page)
  assert.equal(await create.locator('svg').count(), 0)
  assert.equal(await importButton.locator('svg.lucide-plus').count(), 1)
  assert.equal(await importButton.locator('svg.lucide-download').count(), 1)
  assert.equal(await create.getAttribute('data-li-contract'), null)
  console.log('PASS moved slot remains with its new source owner, stale choice has no control or effect')
  await page.close()
}
try {
  await queueTrial()
  await transferTrial()
} finally {
  await browser.close()
  for (const s of servers.reverse()) await s.close()
}
