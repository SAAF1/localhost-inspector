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

test('Component audit keeps rendered slots and registered definitions distinct across scans', async t => {
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
    const register = (id, library) =>
      window.registerComponent(document.getElementById(id), { name: 'Checkbox', library }, {})
    const dispose = register('first', 'Controls')
    register('second', 'Controls')
    register('third', 'Other Controls')
    const scan = id => ui.scanVariablesPage(document, { id }).entries.filter(item => item.category === 'component')
    const first = scan('/tasks')
    const checkbox = first.find(item => item.value === 'checkbox')
    const saved = structuredClone(checkbox.occurrences.map(({ node, ...hit }) => hit))
    const live = scan('/tasks').find(item => item.id === checkbox.id)
    const inventory = ui.variablesInventory([{ page: { id: '/tasks' }, entries: first },
      { page: { id: '/users' }, entries: scan('/users') }])
    dispose()
    return {
      types: Object.fromEntries(first.map(item => [item.value, [item.name, item.occurrences.length]])),
      grouped: inventory.entries.find(item => item.id === checkbox.id).occurrences.length,
      live: ui.findVariableOccurrence(live, checkbox.occurrences[1])?.node === checkbox.occurrences[1].node,
      relocated: ui.findVariableOccurrence(live, saved[0])?.node.getAttribute('aria-label'),
      ambiguous: ui.findVariableOccurrence(live, saved[1]) === null,
      disposed: document.getElementById('first').hasAttribute('data-inspector-component-definition'),
    }
  })
  assert.deepEqual(result, {
    types: {
      checkbox: ['Checkbox', 3],
      'icon-button': ['Icon Button', 1],
      icon_button: ['Icon Button', 1],
      'Checkbox · Controls': ['Checkbox', 2],
      'Checkbox · Other Controls': ['Checkbox', 1],
    },
    grouped: 6, live: true, relocated: 'Select all', ambiguous: true, disposed: false,
  })
})
