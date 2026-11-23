import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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
      .chip, #named {
        font-family: var(--text-body-font-family); font-size: var(--text-body-font-size);
        line-height: var(--text-body-line-height); font-weight: var(--text-body-font-weight);
        letter-spacing: var(--text-body-letter-spacing);
      }
      #group { background: white; --ink: #445566; --pad: 9px }
      #named { background: oklch(1 0 0) }
      .chip { color: var(--ink); padding: var(--pad); display: inline-block }
      .different { margin-top:2vw; padding:6px; margin-inline:auto; display:block; width:100px; font-style: italic; color: #112233 }
    </style>`
    const content = '<div id="group"><span class="chip">Repeat</span><span class="chip">Repeat</span>' +
      '<span class="different">Italic</span><span>Same measurements</span><span hidden>Hidden</span><span id="named">Unique</span></div>'
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
      bodyCount: body.occurrences.length, literalNames: first.entries.filter(e => e.category === 'typography' && !e.name).flatMap(e => e.occurrences.map(hit => hit.label)).sort(),
      linkedInk: first.entries.filter(e => e.name === 'ink' && e.value === 'rgb(68, 85, 102)').flatMap(e => e.occurrences).length, unused: by(first, 'color', 'other-ink').occurrences.length,
      fixedLiteral: by(first, 'spacing', undefined)?.value,
      autoMargins: first.entries.filter(entry => entry.category === 'spacing').flatMap(entry => entry.occurrences)
        .filter(hit => hit.label === 'Italic' && hit.property === 'margin').length,
      pads: first.entries.filter(e => e.name === 'pad' && e.value === '9px').flatMap(e => e.occurrences.map(hit => hit.edges)),
      ambiguous: ui.findVariableOccurrence(next, repeat) === null,
      relocated: ui.findVariableOccurrence(next, unique)?.node === doc.querySelector('#named'),
      merged: by(ui.variablesInventory([first, collect('/second'), again]), 'typography', 'Body').occurrences.length,
    }
  })
  assert.deepEqual(results, {
    rawWhite: 2, withSavedScreen: 3,
    bodyCount: 3, literalNames: ['Italic', 'Same measurements'], linkedInk: 2, unused: 0,
    fixedLiteral: '6px', autoMargins: 0,
    pads: [['top', 'right', 'bottom', 'left'], ['top', 'right', 'bottom', 'left']],
    ambiguous: true, relocated: true, merged: 6,
  })
})

test('Components requires a registered slot or property and ignores legacy part counts', async t => {
  const browser = await chromium.launch(process.env.INSPECTOR_BROWSER ? { executablePath: process.env.INSPECTOR_BROWSER } : {})
  t.after(() => browser.close())
  const page = await browser.newPage()
  await page.route('https://app.test/', route => route.fulfill({ body: '<!doctype html>' }))
  await page.goto('https://app.test/')
  await page.setContent(`<button data-slot="checkbox" aria-label="Select all"></button>
    <button data-slot="checkbox" aria-label="Select row"></button>
    <button data-slot="checkbox" aria-label="Select row"></button>
    <button data-slot="checkbox" hidden></button>
    <button data-slot="icon-button">One</button><button data-slot="icon_button">Two</button>
    <button id="first" data-slot="checkbox">First</button>
    <button id="second">Second</button><button id="third">Third</button>
    <button data-inspector-component="legacy-mount">Legacy</button>`)
  const integration = await readFile(join(project, 'integrations/component-preview.mjs'), 'utf8')
  await page.addScriptTag({ content: integration.replace('export function', 'function') })
  await page.evaluate(() => { window.LocalhostInspector = {} })
  for (const file of ['ui/authored-styles', 'ui/text-style-values', 'ui/color-bindings', 'ui/solid-color-picker', 'ui/spacing-gap', 'variables-audit']) {
    await page.addScriptTag({ path: join(project, 'extension', file + '.js') })
  }
  const result = await page.evaluate(() => {
    const ui = window.LocalhostInspector
    const register = (id, library, fields) => window.registerComponent(document.getElementById(id),
      { name: 'Checkbox', library, ...fields }, { readProperty: () => 'small' })
    const dispose = register('first', 'Controls', { properties: [{ id: 'size' }] })
    register('second', 'Controls', { properties: [{ id: 'size' }] })
    document.getElementById('second').setAttribute('data-inspector-component-definition', JSON.stringify(['Controls', 'Checkbox']))
    register('third', 'Other Controls', { slots: [{ id: 'icon' }] })
    window.registerComponent(document.querySelector('[data-slot="icon-button"]'), { name: 'Wrapper' }, {})
    const source = 'src/Tile.tsx'
    const sourceRoot = document.querySelector('[data-slot="icon-button"]')
    const tile = document.querySelector('[data-slot="icon_button"]')
    tile.setAttribute('data-slot', sourceRoot.getAttribute('data-slot'))
    tile.setAttribute('data-inspector-source', JSON.stringify([source, 'Tile']))
    tile.setAttribute('data-inspector-instance', 'tile-1')
    const componentCatalog = { definitions: [{ source, name: 'Tile', fields: ['tone'] }] }
    const scan = id => ui.scanVariablesPage(document, { id }, { componentCatalog })
    const tasks = scan('/tasks')
    const entries = tasks.entries.filter(item => item.category === 'component')
    const checkbox = entries.find(item => item.value === 'Checkbox · Controls')
    const inventory = ui.variablesInventory([tasks, scan('/users'), {
      page: { id: '/legacy' }, componentCoverage: 'rendered-markers', entries: [checkbox],
    }])
    dispose()
    return {
      types: Object.fromEntries(entries.map(item => [item.value, item.occurrences.length])),
      grouped: inventory.entries.find(item => item.id === checkbox.id).occurrences.length,
      afterDispose: scan('/tasks').entries.find(item => item.id === checkbox.id).occurrences.length,
    }
  })
  assert.deepEqual(result, {
    types: { Tile: 1, 'Checkbox · Controls': 2, 'Checkbox · Other Controls': 1 }, grouped: 4, afterDispose: 1,
  })
})
