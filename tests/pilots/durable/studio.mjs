import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openStudio } from '../../../scripts/studio-browser.mjs'

const dir = resolve(process.argv[2])
const profile = await mkdtemp(join(tmpdir(), 'studio-installed-'))
const start = performance.now()
const { context, page, worker, version } = await openStudio(dir, { headless: true, profile })
const frame = page.frameLocator('#app-preview')
const button = (name) => frame.getByRole('button', { name, exact: true })
page.setDefaultTimeout(9000)
async function panel(selector, label = '', click = true) {
  const limit = Date.now() + 6000
  let result
  do {
    result = await worker.evaluate(
      async ({ origin, selector, label }) => {
        const [tab] = await chrome.tabs.query({ url: origin + '/__inspector-flow/*' })
        const [{ result }] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (selector, label) => {
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
            node.scrollIntoView({ block: 'nearest' })
            const r = node.getBoundingClientRect()
            return { x: r.x + r.width / 2, y: r.y + r.height / 2, text: node.textContent }
          },
          args: [selector, label],
        })
        return result
      },
      { origin: version.origin, selector, label },
    )
    if (result?.x !== undefined) {
      if (click) await page.mouse.click(result.x, result.y)
      return result.text
    }
    await page.waitForTimeout(80)
  } while (Date.now() < limit)
  throw Error('Control unavailable ' + selector + ' ' + label + ' ' + JSON.stringify(result))
}
async function until(check, label) {
  for (let i = 0; i < 80; i++) {
    if (await check()) return
    await page.waitForTimeout(100)
  }
  throw Error(label)
}
try {
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
} finally {
  await context.close()
}
