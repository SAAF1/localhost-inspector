import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { chromium } from 'playwright'

const [address, flow, directory] = process.argv.slice(2)
if (!address || !flow || !directory) throw Error('Usage: npm run review:flow -- CANVAS_URL FLOW_ID OUTPUT_DIRECTORY')
const canvas = new URL('/__inspector-flow/', address)
const response = await fetch(new URL('map.json?previewOrigins=on-demand', canvas))
if (!response.ok) throw Error('Cannot load canvas manifest: ' + response.status)
const map = await response.json()
const steps = (map.variants ?? []).filter(step => step.id.startsWith(flow + '~'))
if (!steps.length) throw Error('No saved steps in flow ' + flow)
const output = resolve(directory)
await mkdir(output, { recursive: true })
const report = { flow, created: new Date().toISOString(), steps: [], errors: [] }
const browser = await chromium.launch({ headless: true, executablePath: process.env.INSPECTOR_BROWSER })
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => report.errors.push(error.message))
  for (const step of steps) {
    const result = { id: step.id, label: step.label, route: step.route, views: {} }
    report.steps.push(result)
    canvas.hash = new URLSearchParams({ context: '1', frame: step.anchor, view: 'canvas', variant: step.id })
    result.canvasUrl = canvas.href
    result.sectionPath = [step.section, ...(step.sectionPath ?? [])].filter(Boolean)
    if (step.note) result.note = step.note
    if (step.reviewNote) result.reviewNote = step.reviewNote
    await page.goto(canvas.href, { waitUntil: 'domcontentloaded' })
    const wrapper = page.locator('[data-variant=' + JSON.stringify(step.id) + ']')
    await wrapper.locator(':scope > button').click()
    const app = wrapper.frameLocator('iframe').locator('body')
    await app.locator(':scope > :not(script):not(style)').first().waitFor({ state: 'attached' })
    const content = await app.evaluate(async body => {
      await body.ownerDocument.fonts.ready
      return { text: body.innerText.trim(), address: body.ownerDocument.location.href }
    })
    let expectedOrigin = step.origin
    if (step.deferredOrigin) {
      const endpoint = new URL('preview-origin', canvas)
      endpoint.searchParams.set('id', step.id)
      const reply = await fetch(endpoint, { headers: { origin: canvas.origin } })
      if (!reply.ok) throw Error('Cannot verify preview origin for ' + step.id)
      const verified = await reply.json()
      if (verified.id !== step.id) throw Error('Incorrect preview identity for ' + step.id)
      expectedOrigin = verified.origin
    }
    if (!content.text || new URL(content.address).origin !== expectedOrigin) throw Error('Missing or incorrect preview for ' + step.id)
    result.textHash = createHash('sha256').update(content.text).digest('hex')
    result.screenshot = String(report.steps.length).padStart(2, '0') + '.png'
    await wrapper.locator('iframe').screenshot({ path: join(output, result.screenshot), animations: 'disabled' })
    const panel = page.frameLocator('iframe[title="Variant layers"]')
    for (const category of ['Components', 'Text styles', 'Colors', 'Spacing', 'Layers']) {
      await panel.locator('.li-var-category').click()
      await panel.locator('.li-menu-option').getByText(category, { exact: true }).click()
      await panel.getByRole('button', { name: category, exact: true }).waitFor()
      if (category === 'Layers') {
        result.views.Layers = await panel.getByRole('tree', { name: 'Layers' }).innerText()
      } else {
        await panel.locator('.li-variables[aria-busy="false"]').waitFor()
        result.views[category] = await panel.locator('.li-variables-body').innerText()
      }
      result.views[category] = result.views[category].slice(0, 500)
    }
    console.log(step.label + ' — reviewed')
  }
} catch (error) {
  report.errors.push(error.message)
} finally {
  await browser.close()
  await writeFile(join(output, 'review.json'), JSON.stringify(report, null, 2) + '\n')
}
if (report.errors.length) throw Error(report.errors.join('\n'))
console.log(join(output, 'review.json'))
