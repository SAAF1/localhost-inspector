import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

test('Selection colors edits a descendant SVG paint, preserves the label, and undoes through Edits', async () => {
  const h = await createHarness({ dock: true, pendingEdits: true })
  try {
    await h.app.evaluate(() => {
      const box = document.createElement('button')
      box.id = 'color-sample'
      box.style.cssText = 'color:var(--ink);--ink:#112233;background:rgba(100,120,140,.5);border:none'
      box.innerHTML = 'Save<svg width="18" height="18" fill="none" stroke="#aa2200"><path id="mark" d="M2 9h14"/><path id="second-mark" d="M9 2v14"/></svg><span hidden style="color:lime">Hidden</span>'
      document.body.prepend(box)
    })
    await h.open()
    await h.select('#color-sample')
    const section = h.host.locator('[data-inspector-section="Selection colors"]')
    const toggle = section.getByRole('button', { name: 'Selection colors', exact: true })
    assert.equal(await section.locator('.li-selection-color-row').count(), 3)
    assert.equal(await section.getByLabel('Selection opacity 64788C').inputValue(), '50')
    await toggle.click()
    assert.equal(await section.getByLabel('Selection hex AA2200').isVisible(), false)
    await toggle.press('Enter')
    const iconRow = section.locator('.li-selection-color-row').filter({ has: h.page.getByLabel('Selection hex AA2200') })
    await iconRow.hover()
    await iconRow.getByRole('button', { name: 'Select item using this color' }).click()
    const hex = section.getByLabel('Selection hex AA2200')
    await hex.fill('FFFFFF')
    await hex.press('Enter')
    await h.settled()
    assert.equal(await h.css('stroke', '#mark'), 'rgb(255, 255, 255)')
    assert.equal(await h.css('stroke', '#second-mark'), 'rgb(255, 255, 255)')
    assert.equal(new Set((await h.journal()).map(edit => edit.group)).size, 1)
    assert.equal(await h.css('color', '#color-sample'), 'rgb(17, 34, 51)')
    const edit = (await h.journal()).at(-1)
    assert.equal(edit.property, 'stroke')
    assert.equal(edit.intent, 'selected occurrence only')
    await h.host.getByRole('tab', { name: 'Edits 1', exact: true }).click()
    assert.equal(await h.host.locator('.li-pending-row').count(), 1)
    await h.previewAction('Undo last preview')
    await h.settled()
    assert.equal(await h.css('stroke', '#mark'), 'rgb(170, 34, 0)')
    assert.equal(await h.css('stroke', '#second-mark'), 'rgb(170, 34, 0)')
  } finally { await h.close() }
})
