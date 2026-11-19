import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { componentPreviewRequest } from '../../extension/component-preview.js'
import { createHarness } from './harness.mjs'

test('shared component registration exposes all declared slots and verifies reversible edits to the chosen instance', async () => {
  const h = await createHarness()
  try {
    await h.open()
    const app = h.app
    const integration = await readFile(new URL('../../integrations/component-preview.mjs', import.meta.url), 'utf8')
    await app.evaluate(async source => {
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }))
      const { registerComponent } = await import(url)
      URL.revokeObjectURL(url)
      const icons = [{ value: 'plus', label: 'Plus' }, { value: 'download', label: 'Download' }]
      const definition = {
        name: 'Action button',
        properties: [{ id: 'label', label: 'Label', kind: 'text' }],
        slots: [{ id: 'icon', label: 'Trailing icon', options: icons }],
      }
      function mount(label, initial) {
        const button = document.createElement('button')
        button.id = label
        button.innerHTML = '<span></span><i></i>'
        button.firstElementChild.textContent = label
        document.body.append(button)
        let state = initial
        const icon = button.lastElementChild
        function draw() {
          icon.textContent = state.value ?? ''
          icon.hidden = !state.visible || button.dataset.loading === 'true'
        }
        draw()
        button.onclick = () => { button.dataset.clicked = 'true' }
        registerComponent(button, definition, {
          readProperty: () => label,
          readSlot: () => ({ ...state, element: icon, renderedValue: icon.textContent,
            unavailableReason: button.dataset.loading === 'true' ? 'Hidden while loading' : null }),
          setSlot: (_, next) => {
            state = next
            if (button.dataset.skipRender !== 'true') draw()
          },
        })
      }
      mount('Create', { value: 'plus', visible: true })
      mount('Import', { value: null, visible: false })
    }, integration)
    // Exercise the same serializable app-world operation the attached worker runs.
    await app.addScriptTag({ content: 'window.testComponentOperation = ' + componentPreviewRequest.toString() })
    await app.evaluate(() => {
      window.phaseABridge = message => window.testComponentOperation(message, location.origin)
    })
    const inspect = label => app.evaluate(label => window.LocalhostInspector.inspectComponent(
      document.querySelector('#' + label + ' span'), location.pathname), label)
    const create = await inspect('Create')
    const other = await inspect('Import')
    assert.equal(create.name, 'Action button')
    assert.equal(create.properties[0].value, 'Create')
    assert.equal(other.slots[0].value, null)
    assert.equal(other.slots[0].options.length, 2)
    const plus = { value: 'plus', visible: true }
    const hidden = { value: 'plus', visible: false }
    const empty = { value: null, visible: false }
    const download = { value: 'download', visible: true }
    const preview = (id, before, requested, route = '/') => app.evaluate(message => window.phaseABridge(message),
      { type: 'previewComponentSlot', id, route, slotId: 'icon', before, requested })
    assert.equal((await preview(create.id, plus, hidden)).status, 'applied')
    assert.equal(await app.locator('#Create i').isVisible(), false)
    assert.equal((await inspect('Create')).slots[0].value, 'plus')
    assert.equal((await preview(create.id, hidden, plus)).status, 'applied')
    assert.equal(await app.locator('#Create i').isVisible(), true)
    assert.equal((await preview(other.id, empty, download)).status, 'applied')
    assert.equal(await app.locator('#Import i').innerText(), 'download')
    assert.equal(await app.locator('#Create i').innerText(), 'plus')
    await app.locator('#Create').click()
    assert.equal(await app.locator('#Create').getAttribute('data-clicked'), 'true')
    assert.equal((await preview(create.id, hidden, plus)).status, 'conflict')
    assert.equal(await preview(create.id, plus, hidden, '/elsewhere'), null)
    await app.locator('#Create').evaluate(node => { node.dataset.skipRender = 'true' })
    assert.equal((await preview(create.id, plus, download)).status, 'rejected')
    assert.equal((await inspect('Create')).slots[0].value, 'plus')
    await app.locator('#Create').evaluate(node => { node.dataset.loading = 'true'; node.lastElementChild.hidden = true })
    assert.equal((await inspect('Create')).slots[0].unavailableReason, 'Hidden while loading')
    assert.equal((await preview(create.id, plus, hidden)).status, 'unavailable')
    await app.locator('#Create').evaluate(node => node.remove())
    assert.equal(await preview(create.id, plus, hidden), null)
  } finally {
    await h.close()
  }
})
