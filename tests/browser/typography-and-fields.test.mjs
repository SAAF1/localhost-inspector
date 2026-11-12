import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

async function addTextFixtures(h) {
  await h.app.evaluate(() => {
    const host = document.createElement('div')
    host.innerHTML = `
      <div id="text-group" style="padding:8px;color:#222">
        <h2 id="headline" style="font-size:24px;font-weight:700;line-height:30px;text-align:left">Tasks</h2>
        <p id="description" style="font-size:16px;font-weight:400;line-height:20px;text-align:right">Here is your list</p>
        <span style="position:absolute;width:1px;height:1px;clip:rect(0,0,0,0);font-size:8px;color:red">Screen reader helper</span>
      </div>
      <p id="inline-runs" style="font-weight:400">A <strong>bold</strong> word</p>
      <button id="text-button"><svg width="12" height="12" aria-hidden="true"></svg><span id="button-label">Sort title</span></button>
      <table><thead><tr id="mixed-header"><th><button role="checkbox" aria-label="Select all"></button></th><th><button>Title</button></th></tr></thead></table>
      <div id="mixed-box" style="padding:8px"><span>Text</span><svg width="12" height="12"></svg></div>
    `
    document.body.append(host)
  })
}

test('Typography shows only for actual text and aggregates a text-only group per property', async () => {
  const h = await createHarness()
  try {
    await addTextFixtures(h)
    await h.open()
    const typography = h.host.locator('.li-type-section')
    await h.select('#mixed-header')
    assert.equal(await typography.count(), 0)
    await h.select('#mixed-box')
    assert.equal(await typography.count(), 0)
    await h.select('#inline-runs')
    const weight = h.host.getByRole('button', { name: 'Font weight', exact: true })
    assert.equal(await weight.innerText(), 'Regular', 'An inline styled run stays part of one text target')
    await h.select('#button-label')
    assert.equal(await typography.isVisible(), true)
    await h.host.getByRole('button', { name: 'Select parent element' }).click()
    assert.equal(await typography.isVisible(), true, 'A selected text-bearing button may have a decorative icon')
    await weight.click()
    const extraLight = h.host.getByRole('menuitemradio', { name: 'Extra Light', exact: true })
    assert.equal(await extraLight.evaluate(node => getComputedStyle(node).whiteSpace), 'nowrap')
    await extraLight.click(); await h.settled()
    assert.equal(await weight.innerText(), 'Extra Light')
    assert.equal(await weight.getAttribute('data-inspector-tooltip'), 'Font weight: Extra Light')
    assert.equal(await weight.locator('span').evaluate(node => getComputedStyle(node).whiteSpace), 'nowrap')
    assert.equal((await h.journal())[0].target.id, 'button-label')

    await h.select('#text-group')
    assert.equal(await weight.innerText(), 'Mixed')
    assert.equal(await h.field('Font size').getAttribute('placeholder'), 'Mixed')
    assert.equal(await h.field('Line height').getAttribute('placeholder'), 'Mixed')
    assert.equal(await h.field('Letter spacing').getAttribute('placeholder'), 'normal')
    assert.equal(await h.host.getByText('Alignment · Mixed').isVisible(), true)
    assert.equal(await h.host.getByRole('textbox', { name: 'Text color' }).inputValue(), '222222')
    await weight.click()
    assert.equal(await h.host.getByRole('menuitemradio', { name: 'Mixed' }).count(), 0)
    await h.page.keyboard.press('Escape')
    await h.enter('Font size', 20); await h.settled()
    assert.equal(await h.css('font-size', '#headline'), '20px')
    assert.equal(await h.css('font-size', '#description'), '20px')
    assert.equal(await h.app.locator('#text-group').evaluate(node => node.style.fontSize), '')
    assert.deepEqual((await h.journal()).slice(1).map(edit => edit.target.id), ['headline', 'description'])
    assert.equal(await h.field('Font size').inputValue(), '20')
  } finally { await h.close() }
})

test('a partial group save preserves the successful text target and offers Undo', async () => {
  const h = await createHarness({ failSave: 2 })
  try {
    await addTextFixtures(h)
    await h.open(); await h.select('#text-group')
    await h.enter('Font size', 20); await h.settled()
    assert.equal(await h.css('font-size', '#headline'), '20px')
    assert.equal(await h.css('font-size', '#description'), '16px')
    assert.match(await h.host.locator('#status').innerText(), /First change saved.*Undo is available/)
    assert.equal((await h.journal()).length, 1)
    await h.host.getByRole('button', { name: 'Undo last preview' }).click(); await h.settled()
    assert.equal(await h.css('font-size', '#headline'), '24px')
  } finally { await h.close() }
})

test('a delayed save retains mounted sections, scroll, and focus while guarding the next edit', async () => {
  const h = await createHarness({ dock: true, holdSave: 1 })
  try {
    await h.page.setViewportSize({ width: 1100, height: 400 })
    await h.open(); await h.select()
    await h.enter('Gap', 12)
    await h.app.waitForFunction(() => typeof window.__releaseSave === 'function')
    const properties = h.host.locator('.li-properties')
    const baseline = await properties.evaluate(node => {
      const section = node.querySelector('.li-layout-section')
      const unrelated = node.querySelector('#control-font-size')
      unrelated.focus({ preventScroll: true })
      node.scrollTop = 156
      node.keep = { section, unrelated }
      return node.scrollTop
    })
    assert.ok(baseline > 0)
    const unrelated = h.field('Font size')
    const oldValue = await unrelated.inputValue()
    assert.equal(await unrelated.evaluate(el => el.readOnly && !el.disabled), true)
    await h.page.keyboard.type('99')
    assert.equal(await unrelated.inputValue(), oldValue)
    await h.app.evaluate(() => window.__releaseSave())
    await h.settled()
    const actual = await properties.evaluate(node => ({
      scroll: node.scrollTop,
      sameSection: node.keep.section === node.querySelector('.li-layout-section'),
      sameInput: node.keep.unrelated === node.querySelector('#control-font-size'),
      focus: node.getRootNode().activeElement === node.keep.unrelated,
      editable: !node.keep.unrelated.readOnly,
    }))
    assert.deepEqual(actual, { scroll: baseline, sameSection: true, sameInput: true, focus: true, editable: true })
    assert.deepEqual((await h.journal()).map(edit => edit.property), ['gap'])
    assert.equal(await h.css('gap'), '12px')
  } finally { await h.close() }
})
