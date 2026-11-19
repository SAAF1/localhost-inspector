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
  for (const file of ['ui/authored-styles', 'ui/text-style-values', 'ui/color-bindings', 'ui/spacing-gap', 'variables-audit']) {
    await page.addScriptTag({ path: join(project, 'extension', file + '.js') })
  }
  const results = await page.evaluate(() => {
    const doc = document.querySelector('iframe').contentDocument
    doc.head.innerHTML = `<style>
      :root { --ink: #112233; --other-ink: #112233; --pad: 6px;
        --text-body-font-family: Arial; --text-body-font-size: 1rem;
        --text-body-font-weight: 400; --text-body-line-height: 1.5; --text-body-letter-spacing: normal }
      body { margin: 0; font: 400 16px/24px Arial }
      .chip { color: var(--ink); padding: 6px; display: inline-block }
      .different { font-style: italic; color: #112233 }
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
    return {
      bodyCount: body.occurrences.length, italicCount: by(first, 'typography', undefined).occurrences.length,
      linkedInk: by(first, 'color', 'ink').occurrences.length, unused: by(first, 'color', 'other-ink').occurrences.length,
      pads: by(first, 'spacing', 'pad').occurrences.map(hit => hit.edges),
      ambiguous: ui.findVariableOccurrence(next, repeat) === null,
      relocated: ui.findVariableOccurrence(next, unique)?.node === doc.querySelector('#named'),
      merged: by(ui.variablesInventory([first, collect('/second'), again]), 'typography', 'Body').occurrences.length,
    }
  })
  assert.deepEqual(results, {
    bodyCount: 3, italicCount: 1, linkedInk: 2, unused: 0,
    pads: [['top', 'right', 'bottom', 'left'], ['top', 'right', 'bottom', 'left']],
    ambiguous: true, relocated: true, merged: 6,
  })
})
