import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

test('one saved template edit follows new uses and route changes and undoes as one operation', async () => {
  const h = await createHarness({ pendingEdits: true })
  try {
    const render = async ids => {
      await h.app.evaluate(ids => {
        const main = document.querySelector('main') ?? document.body.appendChild(document.createElement('main'))
        main.innerHTML = '<table><tbody></tbody></table>'
        const body = main.querySelector('tbody')
        for (const id of ids) {
          const row = body.insertRow()
          row.dataset.record = id
          for (const template of ['orders/status', 'orders/priority']) {
            const label = document.createElement('span')
            label.dataset.inspectorTemplate = template
            label.style.fontSize = '14px'
            label.textContent = 'Ready'
            row.insertCell().append(label)
          }
        }
      }, ids)
    }
    const status = '[data-inspector-template="orders/status"]'
    const priority = '[data-inspector-template="orders/priority"]'
    const sizes = selector => h.app.locator(selector).evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fontSize))
    await render(['a', 'b'])
    await h.open()
    await h.select('[data-record="a"] ' + status)
    await h.enter('Font size', 22)
    await h.settled()
    assert.deepEqual(await sizes(status), ['22px', '22px'])
    assert.deepEqual(await sizes(priority), ['14px', '14px'])
    const [edit] = await h.journal()
    assert.equal((await h.journal()).length, 1)
    assert.equal(edit.template, 'orders/status')
    await render(['b', 'c'])
    await h.app.waitForFunction(selector => [...document.querySelectorAll(selector)].every(node => node.style.fontSize === '22px'), status)
    await h.settled()
    await h.app.evaluate(() => history.pushState(null, '', '/paid'))
    await render(['d', 'e'])
    await h.app.evaluate(() => window.phaseAInspectorReady)
    await h.app.waitForFunction(selector => [...document.querySelectorAll(selector)].every(node => node.style.fontSize === '22px'), status)
    assert.deepEqual(await sizes(status), ['22px', '22px'])
    await h.showEdits()
    await h.host.locator('.li-pending-open').click()
    assert.equal(new URL(h.app.url()).pathname, '/paid')
    await h.previewAction('Show original')
    assert.deepEqual(await sizes(status), ['14px', '14px'])
    await h.previewAction('Show previews')
    await h.settled()
    assert.deepEqual(await sizes(status), ['22px', '22px'])
    await h.select('[data-record="d"] ' + status)
    await h.enter('Font size', 25)
    await h.settled()
    await h.showEdits()
    const remove = h.host.locator('button[aria-label^="Remove"][data-edit-id="' + edit.id + '"]')
    await remove.locator('..').hover()
    await remove.click()
    await h.settled()
    assert.deepEqual(await sizes(status), ['25px', '25px'])
    assert.equal((await h.journal())[0].before, '14px')
    await h.previewAction('Undo last preview')
    await h.settled()
    assert.deepEqual(await h.journal(), [])
    assert.deepEqual(await sizes(status), ['14px', '14px'])
    assert.deepEqual(await sizes(priority), ['14px', '14px'])
  } finally { await h.close() }
})

test('a rendered record change defeats a lookalike without disabling ordinary recovery', async () => {
  const h = await createHarness()
  try {
    await h.app.evaluate(() => document.body.insertAdjacentHTML('beforeend', `
      <main><h1>Orders</h1><div data-record="a"><button>Details</button></div></main>`))
    await h.open()
    await h.select('main button')
    const baseline = await h.css('font-size', 'main button')
    await h.enter('Font size', 22)
    await h.settled()
    await h.select('main h1')
    await h.enter('Font size', 28)
    await h.settled()
    await h.app.locator('[data-record]').evaluate(node => { node.dataset.record = 'b' })
    await h.app.waitForFunction(value => getComputedStyle(document.querySelector('main button')).fontSize === value, baseline)
    await h.app.locator('[data-record]').evaluate(node => { node.dataset.record = 'a' })
    await h.app.waitForFunction(() => getComputedStyle(document.querySelector('main button')).fontSize === '22px')
    const go = async path => {
      await h.app.evaluate(path => history.pushState(null, '', path), path)
      await h.app.evaluate(() => window.phaseAInspectorReady)
    }
    await go('/other')
    await h.app.locator('[data-record]').evaluate(node => {
      const replacement = node.cloneNode(true)
      replacement.dataset.record = 'b'
      node.replaceWith(replacement)
    })
    await go('/')
    assert.equal(await h.css('font-size', 'main button'), baseline)
    assert.equal(await h.css('font-size', 'main h1'), '28px')
    const [edit] = await h.journal()
    assert.match(edit.target.contextFingerprint, /^[a-f0-9]{64}$/)
    assert.equal(edit.target.context, undefined)
  } finally { await h.close() }
})
