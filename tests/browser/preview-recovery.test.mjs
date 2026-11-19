import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

test('same-page remount restores ordered previews and Undo still works offscreen', async () => {
  const h = await createHarness()
  try {
    await h.open(); await h.select()
    await h.enter('Corner radius', 12); await h.settled()
    await h.enter('Corner radius', 18); await h.settled()
    await h.app.evaluate(() => {
      const node = document.getElementById('target')
      node.parentNode.append(node)
    })
    assert.equal(await h.css('border-radius'), '18px')
    const detach = () => h.app.evaluate(() => {
      const node = document.getElementById('target')
      window.fixtureReplacement = node.cloneNode(true)
      window.fixtureReplacement.removeAttribute('style')
      node.remove()
    })
    const remount = () => h.app.evaluate(() => document.body.prepend(window.fixtureReplacement))
    const notice = h.host.locator('#status')
    const waitForRadius = value => h.app.waitForFunction(radius => {
      const node = document.getElementById('target')
      return node && getComputedStyle(node).borderRadius === radius
    }, value)
    await detach()
    await notice.getByText('Some saved previews could not be restored.').waitFor()
    await remount()
    await waitForRadius('18px')
    await h.settled()
    await detach()
    await notice.getByText('Some saved previews could not be restored.').waitFor()
    await h.previewAction('Undo last preview')
    await h.settled()
    await remount()
    await waitForRadius('12px')
    await h.settled()
    assert.deepEqual((await h.journal()).map(edit => edit.requested), ['12px'])
    assert.equal(await notice.innerText(), '')
  } finally { await h.close() }
})

test('an old text-only record cannot style a lookalike on load or same-page remount', async () => {
  const h = await createHarness({ journal: [{
    id: 'old-edit', route: '/', target: { tag: 'span', id: null, slot: null, text: 'One' },
    property: 'font-size', before: '12px', requested: '18px', restore: 'unique',
  }] })
  try {
    const selector = '#target > span:first-child'
    await h.open()
    assert.equal(await h.css('font-size', selector), '12px')
    await h.app.locator(selector).evaluate(node => node.replaceWith(node.cloneNode(true)))
    assert.equal(await h.css('font-size', selector), '12px')
    assert.match(await h.host.locator('#status').innerText(), /could not be restored/)
    await h.previewAction('Undo last preview')
    await h.settled()
    assert.deepEqual(await h.journal(), [])
    assert.equal(await h.css('font-size', selector), '12px')
  } finally { await h.close() }
})

test('Original restores the same live unkeyed element but honors a retired edit', async () => {
  const h = await createHarness()
  const selector = '#target > span:first-child'
  try {
    await h.open(); await h.select(selector)
    await h.enter('Font size', 18); await h.settled()
    await h.previewAction('Show original'); await h.settled()
    assert.equal(await h.css('font-size', selector), '12px')
    await h.previewAction('Show previews'); await h.settled()
    assert.equal(await h.css('font-size', selector), '18px')
    await h.previewAction('Show original'); await h.settled()
    await h.app.evaluate(() => { window.__journal[0].undone = true })
    await h.previewAction('Show previews'); await h.settled()
    assert.equal(await h.css('font-size', selector), '12px')
    assert.equal(await h.host.locator('#undo').isDisabled(), true)
  } finally { await h.close() }
})

test('an ID collision suspends a preview until the original is uniquely identifiable', async () => {
  const h = await createHarness()
  try {
    await h.open(); await h.select()
    await h.enter('Corner radius', 18); await h.settled()
    await h.app.evaluate(() => {
      const node = document.getElementById('target')
      const duplicate = node.cloneNode(true)
      duplicate.removeAttribute('style')
      node.after(duplicate)
    })
    const notice = h.host.locator('#status')
    await notice.getByText('Some saved previews could not be restored.').waitFor()
    assert.deepEqual(await h.app.locator('body > #target').evaluateAll(nodes =>
      nodes.map(node => getComputedStyle(node).borderRadius)), ['0px', '0px'])
    await h.app.locator('body > #target').last().evaluate(node => node.remove())
    await h.app.waitForFunction(() => getComputedStyle(document.getElementById('target')).borderRadius === '18px')
    await h.settled()
    assert.equal(await notice.innerText(), '')
  } finally { await h.close() }
})

test('reordering children keeps the preview on their mounted container', async () => {
  const h = await createHarness()
  try {
    await h.open(); await h.select()
    await h.enter('Corner radius', 18); await h.settled()
    await h.app.locator('body > #target').evaluate(node => node.append(node.firstElementChild))
    await h.previewAction('Show original'); await h.settled()
    assert.equal(await h.css('border-radius'), '0px')
    await h.previewAction('Show previews'); await h.settled()
    assert.equal(await h.css('border-radius'), '18px')
    assert.equal(await h.host.locator('#status').innerText(), '')
  } finally { await h.close() }
})

test('an explicit occurrence key restores the matching part with updated text', async () => {
  const h = await createHarness()
  const selector = '[data-inspector-target="record:1/title"]'
  try {
    await h.app.locator('#target > span:first-child').evaluate(node => {
      node.setAttribute('data-inspector-target', 'record:1/title')
    })
    await h.open(); await h.select(selector)
    await h.enter('Font size', 18); await h.settled()
    assert.equal((await h.journal())[0].target.key, 'record:1/title')
    await h.app.locator(selector).evaluate(node => {
      const replacement = node.cloneNode(false)
      replacement.removeAttribute('style')
      replacement.textContent = 'Updated title'
      const other = replacement.cloneNode(true)
      other.setAttribute('data-inspector-target', 'record:2/title')
      node.replaceWith(other, replacement)
    })
    await h.app.waitForFunction(selector => getComputedStyle(document.querySelector(selector)).fontSize === '18px', selector)
    assert.equal(await h.css('font-size', '[data-inspector-target="record:2/title"]'), '12px')
    await h.settled()
    await h.previewAction('Undo last preview'); await h.settled()
    assert.equal(await h.css('font-size', selector), '12px')
  } finally { await h.close() }
})

test('an app style takeover retires the live preview stack but keeps its saved Undo', async () => {
  const h = await createHarness()
  try {
    await h.open(); await h.select()
    await h.enter('Corner radius', 12); await h.settled()
    await h.enter('Corner radius', 18); await h.settled()
    await h.app.locator('body > #target').evaluate(node => { node.style.borderRadius = '12px' })
    await h.host.locator('#clear:disabled').waitFor({ state: 'attached' })
    await h.settled()
    assert.match(await h.host.locator('#status').innerText(), /app|conflict/i)
    assert.equal(await h.css('border-radius'), '12px')
    for (let count = 0; count < 2; count++) {
      await h.previewAction('Undo last preview'); await h.settled()
      assert.equal(await h.css('border-radius'), '12px')
    }
    assert.deepEqual(await h.journal(), [])
  } finally { await h.close() }
})

test('a conflicting cascade change leaves the app value in place', async () => {
  const h = await createHarness()
  try {
    await h.open(); await h.select()
    await h.enter('Corner radius', 18); await h.settled()
    await h.app.evaluate(() => {
      const style = document.createElement('style')
      style.textContent = '.override #target { border-radius: 27px !important; }'
      document.head.append(style)
      document.body.classList.add('override')
    })
    await h.host.locator('#clear:disabled').waitFor({ state: 'attached' })
    await h.settled()
    assert.match(await h.host.locator('#status').innerText(), /app|conflict/i)
    assert.equal(await h.css('border-radius'), '27px')
    assert.equal(await h.app.locator('body > #target').evaluate(node => node.style.borderRadius), '')
    await h.previewAction('Undo last preview'); await h.settled()
    assert.equal(await h.css('border-radius'), '27px')
  } finally { await h.close() }
})

test('an ID-based preview omits selected text and refuses an ID reused for different content', async () => {
  const h = await createHarness()
  try {
    await h.open()
    await h.select()
    await h.enter('Corner radius', 18)
    await h.settled()
    const [{ target }] = await h.journal()
    assert.equal(target.text, undefined)
    assert.match(target.textFingerprint, /^[a-f0-9]{64}$/)
    await h.app.locator('body > #target').evaluate(node => {
      const replacement = node.cloneNode(false)
      replacement.removeAttribute('style')
      replacement.textContent = 'A different item'
      node.replaceWith(replacement)
    })
    await h.host.getByText('Some saved previews could not be restored.').waitFor()
    assert.equal(await h.css('border-radius'), '0px')
    await h.previewAction('Undo last preview')
    await h.settled()
    assert.deepEqual(await h.journal(), [])
  } finally { await h.close() }
})

test('an unkeyed edit records cell position for source handoff without using it for preview restoration', async () => {
  const h = await createHarness()
  try {
    await h.app.evaluate(() => {
      const table = document.createElement('table')
      table.innerHTML = '<tbody><tr><td><div>Private row value</div></td><td><div>Other content</div></td></tr></tbody>'
      table.querySelector('td').setAttribute('data-slot', 'table-cell')
      table.querySelector('tr').setAttribute('role', 'row')
      document.querySelector('#target').append(table)
    })
    const example = 'td:first-child > div'
    await h.open(); await h.select(example)
    await h.enter('Corner radius', 18); await h.settled()
    const [record] = await h.journal()
    assert.equal(record.intent, 'feature-template')
    assert.equal(record.restore, 'ambiguous')
    assert.equal(record.sourceContext.tableCellPosition, 1)
    assert.equal(record.sourceContext.tableRowCellCount, 2)
    assert.deepEqual(record.sourceContext.ancestors.slice(0, 3),
      [{ tag: 'td', slot: 'table-cell' }, { tag: 'tr', slot: null, role: 'row' }, { tag: 'tbody', slot: null }])
    assert.doesNotMatch(JSON.stringify(record), /Private row value|Other content/)
    await h.app.locator(example).evaluate(node => {
      const replacement = document.createElement('div')
      replacement.textContent = 'Replacement'
      node.replaceWith(replacement)
    })
    await h.host.getByText('Some saved previews could not be restored.').waitFor()
    assert.equal(await h.css('border-radius', example), '0px')
    assert.equal((await h.journal()).length, 1)
  } finally { await h.close() }
})

test('an identical replacement reusing an ID in another region does not inherit a saved edit', async () => {
  const h = await createHarness()
  try {
    const original = '#source-area #target'
    const lookalike = '#other-area #target'
    await h.app.evaluate(() => {
      const first = document.createElement('section')
      first.id = 'source-area'
      const second = document.createElement('section')
      second.id = 'other-area'
      document.body.append(first, second)
      first.append(document.getElementById('target'))
    })
    await h.open()
    await h.select(original)
    await h.enter('Corner radius', 18)
    await h.settled()
    assert.equal(await h.css('border-radius', original), '18px')

    await h.app.locator(original).evaluate(node => {
      const replacement = node.cloneNode(true)
      replacement.removeAttribute('style')
      node.remove()
      document.getElementById('other-area').append(replacement)
    })
    await h.host.getByText('Some saved previews could not be restored.').waitFor({ timeout: 1700 })
    assert.equal(await h.css('border-radius', lookalike), '0px')
    const records = await h.journal()
    assert.equal(records.length, 1)
    assert.match(records[0].target.regionFingerprint, /^[a-f0-9]{64}$/)
    assert.doesNotMatch(JSON.stringify(records[0].target), /source-area|other-area/)
    await h.app.locator(lookalike).evaluate(node => document.getElementById('source-area').append(node))
    await h.app.waitForFunction(selector => getComputedStyle(document.querySelector(selector)).borderRadius === '18px', original)
    await h.settled()
    await h.previewAction('Undo last preview')
    await h.settled()
    assert.equal(await h.css('border-radius', original), '0px')
  } finally { await h.close() }
})

test('recovery checks replacement classes and the latest app value before reapplying a preview', async () => {
  const h = await createHarness()
  try {
    const target = h.app.locator('#target')
    await target.evaluate(node => { node.className = 'owner-a common' })
    await h.open()
    await h.select()
    await h.enter('Corner radius', 18)
    await h.settled()

    await target.evaluate(node => {
      const replacement = node.cloneNode(true)
      replacement.removeAttribute('style')
      replacement.className = 'owner-b common'
      node.replaceWith(replacement)
    })
    const notice = h.host.getByText('Some saved previews could not be restored.')
    await notice.waitFor()
    assert.equal(await h.css('border-radius'), '0px')
    const [record] = await h.journal()
    assert.match(record.target.classFingerprint, /^[a-f0-9]{64}$/)
    assert.doesNotMatch(JSON.stringify(record.target), /owner-a|owner-b/)

    await target.evaluate(node => {
      const replacement = node.cloneNode(true)
      replacement.className = 'common owner-a'
      node.replaceWith(replacement)
    })
    await h.app.waitForFunction(() => getComputedStyle(document.querySelector('#target')).borderRadius === '18px')
    await h.settled()
    await target.evaluate(node => { node.className = 'owner-b common' })
    await notice.waitFor()
    assert.equal(await h.css('border-radius'), '0px')
    await target.evaluate(node => { node.className = 'common owner-a' })
    await h.app.waitForFunction(() => getComputedStyle(document.querySelector('#target')).borderRadius === '18px')
    await h.settled()

    await target.evaluate(node => {
      const replacement = node.cloneNode(true)
      replacement.removeAttribute('style')
      const digest = crypto.subtle.digest
      crypto.subtle.digest = function (...args) {
        replacement.style.borderRadius = '9px'
        crypto.subtle.digest = digest
        return digest.apply(this, args)
      }
      node.replaceWith(replacement)
    })
    await notice.waitFor()
    assert.equal(await h.css('border-radius'), '9px')
    assert.equal((await h.journal()).length, 1)
  } finally { await h.close() }
})

test('a unique heading inside a stable region replays after a route change and rejects a lookalike or duplicate', async () => {
  const h = await createHarness()
  try {
    await h.app.evaluate(() => {
      for (const id of ['main-content', 'independent-panel']) {
        const section = document.createElement(id === 'main-content' ? 'main' : 'section')
        section.id = id === 'main-content' ? '' : id
        section.innerHTML = '<div><h1 style="font-size: 20px">Original title</h1></div>'
        document.querySelector('#target').after(section)
      }
    })
    const original = 'main h1'
    const independent = '#independent-panel h1'
    const go = async path => {
      await h.app.evaluate(path => history.pushState(null, '', path), path)
      await h.app.evaluate(() => window.phaseAInspectorReady)
    }
    await h.open()
    await h.select(original)
    await h.enter('Font size', 26)
    await h.settled()
    const [record] = await h.journal()
    assert.equal(record.restore, 'unique')
    assert.deepEqual(record.target.anchor, { kind: 'main', value: 'main', path: 'div>h1' })
    assert.equal(record.target.text, undefined)
    assert.doesNotMatch(JSON.stringify(record), /Original title/)

    await go('/other')
    await h.app.locator(original).evaluate(node => node.replaceWith(node.cloneNode(true)))
    await go('/')
    assert.equal(await h.css('font-size', original), '26px')
    assert.equal(await h.css('font-size', independent), '20px')

    await go('/other')
    await h.app.locator(original).evaluate(node => { node.textContent = 'Different title' })
    await go('/')
    assert.equal(await h.css('font-size', original), '20px')

    await go('/other')
    await h.app.locator(original).evaluate(node => {
      node.textContent = 'Original title'
      node.after(node.cloneNode(true))
    })
    await go('/')
    assert.deepEqual(await h.app.locator(original).evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fontSize)), ['20px', '20px'])
    await h.app.locator(original).last().evaluate(node => node.remove())
    await h.app.waitForFunction(() => getComputedStyle(document.querySelector('main h1')).fontSize === '26px')
  } finally { await h.close() }
})

test('a button inside an unkeyed repeated item stays session-only even with one row', async () => {
  const h = await createHarness()
  try {
    await h.app.evaluate(() => {
      document.querySelector('#target').insertAdjacentHTML('afterend',
        '<section id="named-list"><ul><li><button type="button">Edit</button></li></ul></section>')
    })
    await h.open()
    await h.select('#named-list button')
    await h.enter('Corner radius', 12)
    await h.settled()
    const [record] = await h.journal()
    assert.equal(record.restore, 'ambiguous')
    assert.equal(record.target.anchor, undefined)
  } finally { await h.close() }
})

test('identical text inside explicitly keyed rows follows the original row after reorder', async () => {
  const h = await createHarness()
  try {
    await h.app.evaluate(() => {
      document.querySelector('#target').insertAdjacentHTML('afterend',
        '<table><tbody><tr data-inspector-target="item-a"><td><span>Status</span></td></tr>' +
        '<tr data-inspector-target="item-b"><td><span>Status</span></td></tr></tbody></table>')
    })
    await h.open()
    await h.select('[data-inspector-target="item-b"] span')
    await h.enter('Font size', 22)
    await h.settled()
    const [saved] = await h.journal()
    assert.equal(saved.restore, 'unique')
    assert.deepEqual(saved.target.anchor, { kind: 'key', value: 'item-b', path: 'td>span' })
    await h.app.evaluate(() => history.pushState(null, '', '/other'))
    await h.app.evaluate(() => window.phaseAInspectorReady)
    await h.app.locator('tbody').evaluate(node => node.prepend(node.lastElementChild.cloneNode(true)))
    await h.app.locator('[data-inspector-target="item-b"]').last().evaluate(node => node.remove())
    await h.app.evaluate(() => history.pushState(null, '', '/'))
    await h.app.evaluate(() => window.phaseAInspectorReady)
    assert.deepEqual(await h.app.locator('tbody span').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fontSize)),
      ['22px', '14px'])
  } finally { await h.close() }
})

test('an older helper stores a scoped candidate as session-only', async () => {
  const h = await createHarness({ legacyPreviewHelper: true })
  try {
    await h.app.evaluate(() => {
      document.querySelector('#target').insertAdjacentHTML('afterend', '<main><h1>Standalone heading</h1></main>')
    })
    await h.open()
    await h.select('main h1')
    await h.enter('Font size', 30)
    await h.settled()
    const [saved] = await h.journal()
    assert.equal(saved.restore, 'ambiguous')
    assert.equal(saved.target.anchor, undefined)
    assert.equal(await h.css('font-size', 'main h1'), '30px')
  } finally { await h.close() }
})
