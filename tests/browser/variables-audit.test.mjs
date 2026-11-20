import assert from 'node:assert/strict'
import test from 'node:test'
import { chromium } from 'playwright'
import { join } from 'node:path'
import { project } from '../../scripts/check-modules.mjs'

test('Variables audits live page values, preserves named roles, and rejects ambiguous replacement hits', async t => {
  const browser = await chromium.launch(process.env.INSPECTOR_BROWSER ? { executablePath: process.env.INSPECTOR_BROWSER } : {})
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.setContent('<iframe></iframe>')
  await page.evaluate(() => { window.LocalhostInspector = {} })
  for (const file of ['ui/authored-styles', 'ui/text-style-values', 'ui/color-bindings', 'ui/solid-color-picker', 'ui/spacing-gap', 'variables-audit']) {
    await page.addScriptTag({ path: join(project, 'extension', file + '.js') })
  }
  const results = await page.evaluate(() => {
    const doc = document.querySelector('iframe').contentDocument
    doc.head.innerHTML = `<style>
      :root { --ink: #112233; --other-ink: #112233; --pad: 6px;
        --text-body-font-family: Arial; --text-body-font-size: 1rem;
        --text-body-font-weight: 400; --text-body-line-height: 1.5; --text-body-letter-spacing: normal }
      body { margin: 0; font: 400 16px/24px Arial }
      #group { background: white }
      #named { background: oklch(1 0 0) }
      .chip { color: var(--ink); padding: var(--pad); display: inline-block }
      .different { margin-top:2vw; padding:6px; margin-inline:auto; display:block; width:100px; font-style: italic; color: #112233 }
    </style>`
    const content = '<div id="group"><span class="chip">Repeat</span><span class="chip">Repeat</span>' +
      '<span class="different">Italic</span><span hidden>Hidden</span><span id="named">Unique</span></div>'
    doc.body.innerHTML = content
    const ui = window.LocalhostInspector
    const catalogs = {
      textStyleCatalog: { names: ['--text-body'] }, colorCatalog: { names: ['--ink', '--other-ink'] },
      spacingCatalog: { names: ['--pad'] },
    }
    const collect = (id = '/first') => ui.scanVariablesPage(doc, { id, label: id }, catalogs)
    const first = collect()
    const by = (scan, category, name) => scan.entries.find(entry => entry.category === category && entry.name === name)
    const body = by(first, 'typography', 'Body')
    const repeat = body.occurrences.find(hit => hit.label === 'Repeat')
    const unique = body.occurrences.find(hit => hit.label === 'Unique')
    doc.body.innerHTML = content
    const again = collect()
    const next = by(again, 'typography', 'Body')
    const white = first.entries.find(item => item.value === 'rgb(255, 255, 255)')
    const legacy = { page: { id: '/saved' }, entries: [
      { category: 'color', id: 'old-white', value: 'oklch(1 0 0)', occurrences: [{ pageId: '/saved' }] },
    ] }
    const combined = ui.variablesInventory([first, legacy])
    return {
      rawWhite: white.occurrences.length,
      withSavedScreen: combined.entries.find(item => item.id === white.id).occurrences.length,
      bodyCount: body.occurrences.length, italicCount: by(first, 'typography', undefined).occurrences.length,
      linkedInk: by(first, 'color', 'ink').occurrences.length, unused: by(first, 'color', 'other-ink').occurrences.length,
      fixedLiteral: by(first, 'spacing', undefined)?.value,
      autoMargins: first.entries.filter(entry => entry.category === 'spacing').flatMap(entry => entry.occurrences)
        .filter(hit => hit.label === 'Italic' && hit.property === 'margin').length,
      pads: by(first, 'spacing', 'pad').occurrences.map(hit => hit.edges),
      ambiguous: ui.findVariableOccurrence(next, repeat) === null,
      relocated: ui.findVariableOccurrence(next, unique)?.node === doc.querySelector('#named'),
      merged: by(ui.variablesInventory([first, collect('/second'), again]), 'typography', 'Body').occurrences.length,
    }
  })
  assert.deepEqual(results, {
    rawWhite: 2, withSavedScreen: 3,
    bodyCount: 3, italicCount: 1, linkedInk: 2, unused: 0,
    fixedLiteral: '6px', autoMargins: 0,
    pads: [['top', 'right', 'bottom', 'left'], ['top', 'right', 'bottom', 'left']],
    ambiguous: true, relocated: true, merged: 6,
  })
})
