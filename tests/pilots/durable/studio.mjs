import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openStudio } from '../../../scripts/studio-browser.mjs'

const dir = resolve(process.argv[2])
const profile = await mkdtemp(join(tmpdir(), 'studio-installed-'))
const start = performance.now()
const coverage = process.argv.includes('--coverage')
const { context, page, worker, version } = await openStudio(dir, {
  headless: true,
  profile,
  id: coverage ? 'b' : 'a',
  route: coverage ? '/users' : '/tasks',
})
const frame = page.frameLocator('#app-preview')
const button = (name) => frame.getByRole('button', { name, exact: true })
page.setDefaultTimeout(9000)
async function panel(selector, label = '', click = true) {
  const limit = Date.now() + 6000
  let result
  do {
    result = await worker.evaluate(
      async ({ origin, selector, label, keyboard }) => {
        const [tab] = await chrome.tabs.query({ url: origin + '/__inspector-flow/*' })
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (selector, label, keyboard) => {
            const host = document.querySelector('#localhost-inspector')
            const root = host && chrome.dom.openOrClosedShadowRoot(host)
            const node = [...(root?.querySelectorAll(selector) ?? [])].find(
              (n) =>
                !n.disabled &&
                !n.hidden &&
                n.getClientRects().length &&
                n.textContent.toLowerCase().includes(label.toLowerCase()),
            )
            if (!node)
              return {
                info: root?.textContent?.slice(-1400),
                shell: document.body.outerHTML.slice(0, 160),
                iframe: document.querySelector('#app-preview')?.outerHTML.slice(0, 300),
                dock: document.querySelector('#localhost-inspector-dock')?.outerHTML.slice(0, 300),
              }
            if (keyboard) node.focus()
            node.scrollIntoView({ block: 'nearest' })
            const r = node.getBoundingClientRect()
            return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: node.textContent }
          },
          args: [selector, label, keyboard],
        })
        return result
      },
      { origin: new URL(page.url()).origin, selector, label, keyboard: click === 'keyboard' },
    )
    if (result?.x !== undefined) {
      if (click === 'keyboard') await page.keyboard.press('Enter')
      else if (click) await page.mouse.click(result.x, result.y)
      return result.text
    }
    await page.waitForTimeout(80)
  } while (Date.now() < limit)
  throw Error('Control unavailable ' + selector + ' ' + label + ' ' + JSON.stringify(result))
}
async function until(check, label) {
  for (let i = 0; i < 80; i++) {
    try {
      if (await check()) return
    } catch (error) {
      if (!/Execution context was destroyed|Frame was detached/.test(error.message)) throw error
    }
    await page.waitForTimeout(100)
  }
  throw Error(label)
}
async function checkCoverage() {
  const title = frame.getByRole('heading', { name: 'User List', exact: true }),
    description = frame.getByText('Manage your users and their roles here.', { exact: true })
  await title.click({ modifiers: ['Meta'] })
  await panel('[aria-label="Font weight"]')
  await panel('[role=menuitemradio]', 'Medium')
  await until(
    () => title.evaluate((n) => getComputedStyle(n).fontWeight === '500'),
    'User heading weight did not change',
  )
  await panel('#inspector-panel:not([aria-busy="true"])', '', false)
  const before = await description.evaluate((n) => getComputedStyle(n).color)
  await description.click({ modifiers: ['Meta'] })
  await panel('[aria-label="Text color variables"]', '', 'keyboard')
  await panel('[role=option]', 'primary')
  await until(
    () => description.evaluate((n, old) => getComputedStyle(n).color !== old, before),
    'User description color did not change',
  )
  await panel('#inspector-panel:not([aria-busy="true"])', '', false)
  await page.reload()
  await until(
    () => title.evaluate((n) => getComputedStyle(n).fontWeight === '500'),
    'Weight did not survive reload',
  )
  const color = await description.evaluate((n) => getComputedStyle(n).color)
  assert.notEqual(color, before)
  console.log('Users heading 500 and text color', before, 'to', color, 'after reload')
}
try {
  if (coverage) {
    const css = join(version.app, 'src/styles/theme.css')
    const source = await readFile(css, 'utf8')
    const hex = process.argv.includes('--hex')
    try {
      if (hex) {
        const modified = source.replace(/--primary: [^;]+;/, '--primary: #234567;')
        assert.notEqual(modified, source)
        await writeFile(css, modified)
        await page.reload()
      }
      await checkCoverage()
      if (hex)
        assert.equal(
          await frame
            .getByText('Manage your users and their roles here.', { exact: true })
            .evaluate((n) => getComputedStyle(n).color),
          'rgb(35, 69, 103)',
        )
      await page.goto(version.origin + '/__inspector-flow/?page=/tasks&editor=extension')
      const inventory = JSON.parse(await readFile(join(version.directory, 'prepared.json'), 'utf8'))
      const site = inventory.sites.find((s) => s.opening.includes('w-25 items-center gap-2'))
      const rows = frame.locator('[data-li-contract*="' + site.id + '"]')
      await rows
        .first()
        .locator('span')
        .click({ modifiers: ['Meta'] })
      await panel('#parent')
      await panel('#control-width')
      await page.keyboard.press('Meta+a')
      await page.keyboard.type('112')
      await page.keyboard.press('Enter')
      await until(
        () =>
          rows.evaluateAll(
            (ns) =>
              ns.length > 1 &&
              ns.every((n) => getComputedStyle(n).width === '112px' && getComputedStyle(n).gap === '8px'),
          ),
        'Shared width did not update independently of gap',
      )
      console.log('PASS Tasks width 112px across rows; gap stayed 8px')
    } finally {
      if (hex) await writeFile(css, source)
    }
  } else {
    const create = button('Create')
    await create.locator('span').click({ modifiers: ['Meta'] })
    console.log('Cold Create click', Math.round(performance.now() - start), 'ms from browser launch')
    await panel('#parent')
    await panel('button[aria-label="Icon"]')
    await panel('[role=menuitemradio]', 'download')
    await until(() => create.locator('svg.lucide-download').count(), 'Create icon did not change')
    console.log('Actual Create icon replaced')
    const imp = button('Import')
    await imp.locator('span').click({ modifiers: ['Meta'] })
    await panel('#parent')
    await panel('button[aria-label="Variant"]')
    await panel('[role=menuitemradio]', 'secondary')
    await until(() => imp.evaluate((n) => n.classList.contains('bg-secondary')), 'Import variant did not change')
    const inventory = JSON.parse(await readFile(join(version.directory, 'prepared.json'), 'utf8'))
    const site = inventory.sites.find((s) => s.opening.includes('w-25 items-center gap-2'))
    assert.ok(site)
    const rows = frame.locator('[data-li-contract*="' + site.id + '"]')
    await rows
      .first()
      .locator('span')
      .click({ modifiers: ['Meta'] })
    await panel('#parent')
    await panel('[aria-label="Gap options"]')
    await panel('[role=menuitem]', 'Apply variable')
    await panel('[role=option]', 'space-6')
    const allGaps = (expected) =>
      rows.evaluateAll(
        (nodes, val) =>
          nodes.length > 0 &&
          nodes.every((n) => getComputedStyle(n).rowGap === val && getComputedStyle(n).columnGap === val),
        expected,
      )
    await until(() => allGaps('24px'), 'Token did not update all rows')
    await page.reload()
    await until(() => allGaps('24px'), 'Token did not survive reload')
    assert.equal(await create.locator('svg.lucide-download').count(), 1)
    assert.equal(await imp.evaluate((n) => n.classList.contains('bg-secondary')), true)
    console.log('Actual Import variant, token and slot survived reload')
    await create.locator('span').click({ modifiers: ['Meta'] })
    await panel('#edits-tab')
    await panel('#clear')
    await until(() => allGaps('8px'), 'Original comparison did not restore gap')
    assert.equal(await create.locator('svg.lucide-plus').count(), 1)
    await panel('#clear')
    await until(() => allGaps('24px'), 'Design comparison did not restore gap')
    if (process.argv.includes('--source-change')) {
      const file = join(version.app, site.file)
      const original = await readFile(file, 'utf8')
      const changed = original.replace(site.opening, site.opening.replace('gap-2', 'gap-3'))
      assert.notEqual(changed, original)
      try {
        await writeFile(file, changed)
        await page.reload()
        await frame.locator('tbody tr').first().waitFor()
        const changedRows = frame.locator('tbody .w-25.gap-3')
        await until(
          () => changedRows.first().evaluate((n) => getComputedStyle(n).gap === '12px'),
          'New app gap did not win',
        )
        await create.locator('span').click({ modifiers: ['Meta'] })
        await panel('#status', 'prepared source changed', false)
        assert.equal(await create.locator('svg.lucide-download').count(), 1)
      } finally {
        await writeFile(file, original)
      }
      await page.reload()
      await until(() => allGaps('24px'), 'Restoring the source did not restore its journal')
      console.log('PASS owner change produced 12px and visible conflict; restoring source recovered 24px')
    }
    if (process.argv.includes('--fork')) {
      const picker = page.getByRole('combobox', { name: 'Design version' })
      await picker.selectOption('duplicate')
      await page.waitForURL((url) => url.origin !== version.origin, { timeout: 60000 })
      await until(() => allGaps('24px'), 'Copied design did not restore parent spacing')
      assert.equal(await create.locator('svg.lucide-download').count(), 1)
      await create.locator('span').click({ modifiers: ['Meta'] })
      await panel('#edits-tab')
      await panel('#undo')
      await until(() => allGaps('8px'), 'Undo in the copy did not restore original spacing')
      assert.equal(await create.locator('svg.lucide-download').count(), 1)
      await picker.selectOption(version.origin)
      await page.waitForURL((url) => url.origin === version.origin)
      await until(() => allGaps('24px'), 'Undo in the copy affected the parent')
      console.log('PASS current-revision fork, independent Undo, comparison and return to parent')
    }
  }
} finally {
  await context.close()
}
