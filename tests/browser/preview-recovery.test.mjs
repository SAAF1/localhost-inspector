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
    await h.host.getByRole('button', { name: 'Undo last preview' }).click()
    await h.settled()
    await remount()
    await waitForRadius('12px')
    await h.settled()
    assert.deepEqual((await h.journal()).map(edit => !!edit.undone), [false, true])
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
    await h.host.getByRole('button', { name: 'Undo last preview' }).click()
    await h.settled()
    assert.equal((await h.journal())[0].undone, true)
    assert.equal(await h.css('font-size', selector), '12px')
  } finally { await h.close() }
})

test('Original restores the same live unkeyed element but honors a retired edit', async () => {
  const h = await createHarness()
  const selector = '#target > span:first-child'
  try {
    await h.open(); await h.select(selector)
    await h.enter('Font size', 18); await h.settled()
    const compare = h.host.locator('#clear')
    await compare.click(); await h.settled()
    assert.equal(await h.css('font-size', selector), '12px')
    await compare.click(); await h.settled()
    assert.equal(await h.css('font-size', selector), '18px')
    await compare.click(); await h.settled()
    await h.app.evaluate(() => { window.__journal[0].undone = true })
    await compare.click(); await h.settled()
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
    const compare = h.host.locator('#clear')
    await compare.click(); await h.settled()
    assert.equal(await h.css('border-radius'), '0px')
    await compare.click(); await h.settled()
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
    await h.host.locator('#undo').click(); await h.settled()
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
      await h.host.locator('#undo').click(); await h.settled()
      assert.equal(await h.css('border-radius'), '12px')
    }
    assert.deepEqual((await h.journal()).map(edit => edit.undone), [true, true])
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
    await h.host.locator('#undo').click(); await h.settled()
    assert.equal(await h.css('border-radius'), '27px')
  } finally { await h.close() }
})
