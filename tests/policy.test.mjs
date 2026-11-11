import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const source = await readFile(new URL('../extension/ui/policy.js', import.meta.url), 'utf8')
function policy() {
  const context = { window: {}, getComputedStyle: node => node.computed }
  vm.runInNewContext(source, context)
  return context.window.LocalhostInspector
}
function node(own = {}, parent = {}) {
  return { computed: { display: 'block', boxSizing: 'border-box', position: 'relative', ...own }, parentElement: { computed: { display: 'block', ...parent } } }
}
test('width modes require the complete supported layout context', () => {
  const ui = policy()
  assert.deepEqual(Array.from(ui.widthModes(node())), ['fill', 'hug'])
  for (const display of ['flex', 'inline-flex', 'grid', 'inline-grid']) {
    assert.equal(ui.widthModes(node({}, { display })).length, 0)
  }
  for (const own of [{ boxSizing: 'content-box' }, { position: 'absolute' }, { display: 'inline' }]) {
    assert.equal(ui.widthModes(node(own)).length, 0)
  }
  assert.equal(ui.widthModes({ computed: {}, parentElement: null }).length, 0)
})
test('layout and border eligibility cannot invent new editable capabilities', () => {
  const ui = policy()
  const block = node({ borderTopStyle: 'none' })
  assert.equal(ui.supported('gap', block), false)
  assert.equal(ui.supported('flex-direction', block), false)
  assert.equal(ui.supported('border-width', block), false)
  assert.equal(ui.supported('border-color', node({ borderTopStyle: 'solid' })), true)
  assert.equal(ui.supported('flex-direction', node({ display: 'grid' })), false)
  assert.equal(ui.supported('padding-left', block), true)
})
