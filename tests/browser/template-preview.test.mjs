import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { createHarness } from './harness.mjs'

test('one saved template edit follows new uses and route changes and undoes as one operation', async () => {
  const h = await createHarness({ pendingEdits: true, appStyles: 'td > span { font-size: 14px }' })
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

test('equal-valued CSS overrides remain separate at save and when templates remount', async () => {
  const h = await createHarness({ pendingEdits: true, appStyles: '.status { font-size: 14px } .status.overdue { font-size: 14px } .status.archived { font-size: 13px }' })
  try {
    const render = () => h.app.evaluate(() => {
      const main = document.querySelector('main') ?? document.body.appendChild(document.createElement('main'))
      main.innerHTML = '<span class="status">Ready</span><span class="status overdue">Ready</span><span class="status">Ready</span>'
      for (const label of main.children) label.dataset.inspectorTemplate = 'orders/status'
    })
    const sizes = () => h.app.locator('.status').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fontSize))
    await render()
    await h.open()
    await h.select('.status:first-child')
    await h.enter('Font size', 22)
    await h.settled()
    assert.deepEqual(await sizes(), ['22px', '14px', '22px'])
    assert.equal(await h.host.locator('#status').innerText(), '')
    await h.select('.status.overdue')
    await h.enter('Font size', 24)
    await h.settled()
    assert.deepEqual(await sizes(), ['22px', '24px', '22px'])
    const [base, overdue] = await h.journal()
    assert.equal(base.template, 'orders/status')
    assert.equal(overdue.template, base.template)
    assert.match(base.templateSourceFingerprint, /^v2:[0-9a-f]{64}$/)
    assert.match(overdue.templateSourceFingerprint, /^v2:[0-9a-f]{64}$/)
    assert.notEqual(base.templateSourceFingerprint, overdue.templateSourceFingerprint)
    await h.app.evaluate(() => {
      const sheet = [...document.styleSheets].find(sheet => [...sheet.cssRules].some(rule => rule.selectorText === '.status'))
      sheet.insertRule('.unrelated { margin: 0 }', 0)
    })
    await h.app.evaluate(() => history.pushState(null, '', '/paid'))
    await render()
    await h.app.evaluate(() => window.phaseAInspectorReady)
    await h.app.waitForFunction(() => [...document.querySelectorAll('.status')].every(node => node.style.fontSize))
    assert.deepEqual(await sizes(), ['22px', '24px', '22px'])
    await h.previewAction('Show original')
    assert.deepEqual(await sizes(), ['14px', '14px', '14px'])
    await h.previewAction('Show previews')
    assert.deepEqual(await sizes(), ['22px', '24px', '22px'])
    await h.previewAction('Undo last preview')
    assert.deepEqual(await sizes(), ['22px', '14px', '22px'])
    await h.app.locator('.status').first().evaluate(node => node.classList.add('overdue'))
    await h.app.waitForFunction(() => !document.querySelector('.status').style.fontSize)
    assert.deepEqual(await sizes(), ['14px', '14px', '22px'])
    await h.app.locator('.status').last().evaluate(node => node.classList.add('archived'))
    await h.app.waitForFunction(() => getComputedStyle(document.querySelector('.archived')).fontSize === '13px')
  } finally { await h.close() }
})

test('a positional stylesheet fingerprint saved by an older inspector still restores and undoes', async () => {
  const source = JSON.stringify([['inline', '/', 1], [0], '.amount', '14px', false])
  const edit = {
    id: 'saved-amount', route: '/', property: 'font-size', before: '14px', requested: '22px', observed: '22px',
    target: { tag: 'span', id: null, slot: null, key: null }, template: 'invoice/amount', restore: 'unique',
    templateSourceFingerprint: createHash('sha256').update(source).digest('hex'),
  }
  const h = await createHarness({ pendingEdits: true, journal: [edit], appStyles: '.amount { font-size: 14px }',
    flowPages: { '/': { body: '<span class="amount" data-inspector-template="invoice/amount">Total</span>' } } })
  try {
    await h.open()
    assert.equal(await h.css('font-size', '.amount'), '22px')
    await h.previewAction('Undo last preview')
    await h.settled()
    assert.equal(await h.css('font-size', '.amount'), '14px')
    assert.deepEqual(await h.journal(), [])
  } finally { await h.close() }
})

test('inherited CSS stays occurrence-only when a peer has an equal-valued parent override', async () => {
  const h = await createHarness({ appStyles: '.order { font-size: 14px } .order.overdue { font-size: 14px }' })
  try {
    await h.app.evaluate(() => document.body.insertAdjacentHTML('beforeend', `
      <main><div class="order"><span data-inspector-target="order:a/status" data-inspector-template="orders/status">Ready</span></div>
      <div class="order overdue"><span data-inspector-target="order:b/status" data-inspector-template="orders/status">Ready</span></div></main>`))
    await h.open()
    await h.select('[data-inspector-target="order:a/status"]')
    await h.enter('Font size', 22)
    await h.settled()
    const [edit] = await h.journal()
    assert.equal(edit.template, undefined)
    assert.equal(await h.css('font-size', '.order:not(.overdue) span'), '22px')
    assert.equal(await h.css('font-size', '.order.overdue span'), '14px')
  } finally { await h.close() }
})

test('rendered inline values on a shared template retain only the selected preview', async () => {
  const h = await createHarness({ pendingEdits: true })
  try {
    const render = () => h.app.evaluate(() => {
      const root = document.querySelector('main') ?? document.body.appendChild(document.createElement('main'))
      const sizes = { ordinary: 14, overdue: 14 }
      root.replaceChildren(...['ordinary', 'overdue', 'ordinary'].map((variant, index) => {
        const node = document.createElement('span')
        node.dataset.inspectorTemplate = 'billing/amount'
        node.dataset.inspectorTarget = 'invoice-' + index
        node.style.fontSize = sizes[variant] + 'px'
        node.textContent = 'Amount'
        return node
      }))
    })
    const selector = '[data-inspector-template="billing/amount"]'
    const sizes = () => h.app.locator(selector).evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fontSize))
    await render()
    await h.open()
    await h.select('[data-inspector-target="invoice-0"]')
    await h.enter('Font size', 22)
    await h.settled()
    assert.deepEqual(await sizes(), ['22px', '14px', '14px'])
    const [edit] = await h.journal()
    assert.equal(edit.template, undefined)
    assert.equal(edit.target.key, 'invoice-0')
    assert.match(await h.host.locator('#status').innerText(), /selected element/i)
    await render()
    await h.app.waitForFunction(() => document.querySelector('[data-inspector-target="invoice-0"]').style.fontSize === '22px')
    assert.deepEqual(await sizes(), ['22px', '14px', '14px'])
    await h.previewAction('Undo last preview')
    await h.settled()
    assert.deepEqual(await sizes(), ['14px', '14px', '14px'])
    assert.deepEqual(await h.journal(), [])
  } finally { await h.close() }
})

test('a saved template edit without a declaration owner stays removable when a default-valued peer remains', async () => {
  const edit = {
    id: 'old-template', route: '/', property: 'opacity', before: '1', requested: '0.5', observed: '0.5',
    target: { tag: 'span', id: null, slot: null, key: null }, template: 'item/amount', restore: 'unique',
  }
  const h = await createHarness({ pendingEdits: true, journal: [edit] })
  try {
    await h.app.evaluate(() => {
      document.body.insertAdjacentHTML('beforeend', '<span data-inspector-template="item/amount">Amount</span>')
    })
    await h.open()
    await h.showEdits()
    await h.host.locator('.li-pending-open').click()
    assert.match(await h.host.locator('#pending-status').textContent(), /source changed|couldn’t be applied/i)
    assert.equal(await h.css('opacity', '[data-inspector-template]'), '1')
    assert.deepEqual(await h.journal(), [edit])
    await h.previewAction('Undo last preview')
    await h.settled()
    assert.deepEqual(await h.journal(), [])
  } finally { await h.close() }
})
