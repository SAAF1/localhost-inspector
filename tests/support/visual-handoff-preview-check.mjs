import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const [, , port, expectedDevice = '8px', expectedIdentity = '8px'] = process.argv
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.goto('http://127.0.0.1:' + port)
  assert.equal(await page.locator('#localhost-inspector').count(), 0)
  for (const [name, selector, expected] of [
    ['Device rules', '.device-rule', expectedDevice],
    ['Identity rules', '.identity-rule', expectedIdentity],
  ]) {
    await page.getByRole('button', { name }).click()
    const actual = await page.locator(selector).evaluateAll(nodes => nodes.map(node => {
      const style = getComputedStyle(node)
      return [style.rowGap, style.columnGap, style.alignItems, node.getAttribute('style')]
    }))
    const expectedRow = [expected, expected, 'center', null]
    assert.deepEqual(actual, [expectedRow, expectedRow], name)
  }
  console.log('Preview-off source check passed across both uses of both templates.')
} finally {
  await browser.close()
}
