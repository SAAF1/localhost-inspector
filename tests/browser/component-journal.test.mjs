import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

async function slotFixture(options = {}) {
  const h = await createHarness({ pendingEdits: true, ...options })
  await h.app.evaluate(() => {
    const node = document.querySelector('#other')
    const id = crypto.randomUUID()
    node.setAttribute('data-inspector-component', id)
    node.setAttribute('data-inspector-component-definition', '["Fixture","Tile",1]')
    node.dataset.icon = 'small'
    const bridge = window.phaseABridge
    window.phaseABridge = async message => {
      if (!['previewComponentSlot','inspectComponent'].includes(message.type)) return bridge(message)
      if (message.id !== node.getAttribute('data-inspector-component')) return null
      const value = node.dataset.icon || null
      if (message.type === 'inspectComponent') return { id, name: 'Tile', properties: [],
        slots: [{ id: 'icon', value, visible: Boolean(value), options: ['small','large'].map(value => ({ value, label: value })) }] }
      if (message.before.value !== value || message.before.visible !== Boolean(value)) return { status: 'conflict' }
      node.dataset.icon = message.requested.value || ''
      return { status: 'applied' }
    }
  })
  await h.open()
  await h.select('#other')
  const choose = async name => {
    await h.host.getByRole('button', {name: 'Icon', exact: true}).click()
    await h.host.getByRole('menuitemradio', { name, exact: true }).click()
    await h.settled()
  }
  const value = () => h.app.locator('#other').getAttribute('data-icon')
  const revert = async () => {
    await h.showEdits()
    await h.host.getByRole('button',{name:'Revert all previews'}).click()
    await h.host.getByRole('dialog').getByRole('button',{name:'Revert all',exact:true}).click()
    await h.app.waitForFunction(() => window.__journal.length === 0)
    await h.settled()
  }
  return { h, choose, value, revert }
}

test('slot changes share the edits journal, comparison, undo and Revert all', async () => {
  const { h, choose, value, revert } = await slotFixture()
  try {
    await choose('large')
    await choose('None')
    assert.equal(await value(), '')
    assert.deepEqual((await h.journal()).map(e => [e.property,e.before,e.requested]), [
      ['component-icon','small','large'], ['component-icon','large','None']])
    await h.previewAction('Show original')
    assert.equal(await value(), 'small')
    await h.previewAction('Show previews')
    assert.equal(await value(), '')
    await h.previewAction('Undo last preview')
    assert.equal(await value(), 'large')
    await revert()
    assert.equal(await value(), 'small')
    assert.deepEqual(await h.journal(), [])
  } finally { await h.close() }
})

test('failed slot save rolls back, and Revert all leaves a remounted instance untouched', async () => {
  const { h, choose, value, revert } = await slotFixture({failSave:1})
  try {
    await choose('large')
    assert.equal(await value(),'small')
    assert.deepEqual(await h.journal(),[])
    await choose('large')
    assert.equal(await value(),'large')
    await h.app.locator('#other').evaluate(node => {
      node.setAttribute('data-inspector-component',crypto.randomUUID())
      node.dataset.icon = 'replacement'
    })
    await revert()
    assert.equal(await value(),'replacement')
    assert.deepEqual(await h.journal(),[])
  } finally { await h.close() }
})

test('Revert all finds a mounted slot after moving to a different route', async () => {
  const { h, choose, value, revert } = await slotFixture()
  try {
    await choose('large')
    await h.app.evaluate(() => history.pushState(null, '', '/another-page'))
    await h.app.waitForFunction(() => document.querySelector('#localhost-inspector').shadowRoot.querySelector('#undo').disabled)
    await revert()
    assert.equal(await value(), 'small')
  } finally { await h.close() }
})

test('inline label edits can be cancelled, recorded, and undone without replacing an icon', async () => {
  const h = await createHarness({ pendingEdits: true })
  try {
    await h.open()
    const label = h.app.locator('#other span')
    await h.app.locator('#other').evaluate(node => {
      node.innerHTML = '<span>Status</span><svg width="12" height="12"></svg>'
      window.originalIcon = node.lastChild
    })
    const editor = h.app.getByRole('textbox', { name: 'Edit text', exact: true })
    await label.dblclick()
    await editor.fill('Discard')
    await editor.press('Escape')
    assert.equal(await label.textContent(), 'Status')
    assert.deepEqual(await h.journal(), [])
    await label.dblclick()
    await editor.fill('Stage')
    await editor.press('Enter')
    await h.app.waitForFunction(() => window.__journal.length === 1)
    assert.equal(await label.textContent(), 'Stage')
    assert.equal((await h.journal())[0].property, 'text')
    await h.settled()
    await h.previewAction('Undo last preview')
    assert.equal(await label.textContent(), 'Status')
    assert.equal(await h.app.evaluate(() => document.querySelector('#other svg') === window.originalIcon), true)
  } finally { await h.close() }
})
