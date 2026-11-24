import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

test('deep layers keep their hierarchy, selection fills and input-specific focus', async () => {
  let body = '<button>Leaf</button>'
  const labels = Array.from({ length: 9 }, (_, i) => 'Level ' + (i + 1))
  for (const label of labels.toReversed()) body = '<section aria-label="' + label + '">' + body + '</section>'
  const h = await createHarness({ canvas: true, dock: true, flowPages: { '/': { body } } })
  try {
    await h.open()
    const tree = h.page.getByRole('tree', { name: 'Layers' })
    const item = label => tree.getByRole('treeitem', { name: label, exact: true })
    const row = label => item(label).locator(':scope > .workspace-layer-line')
    for (const label of labels) {
      if (await item(label).getAttribute('aria-expanded') === 'false') {
        await row(label).locator('.workspace-layer-caret').click()
      }
    }
    const geometry = []
    for (const label of [...labels, 'Leaf']) {
      geometry.push(await row(label).evaluate(el => {
        const box = el.getBoundingClientRect()
        return [box.x, box.right, el.querySelector('.workspace-layer-label').getBoundingClientRect().x]
      }))
    }
    for (let i = 1; i < geometry.length; i++) {
      assert.equal(geometry[i][0], geometry[0][0], 'row fills share their left edge')
      assert.equal(geometry[i][1], geometry[0][1], 'row fills share their right edge')
      assert.equal(geometry[i][2] - geometry[i - 1][2], 24, 'each visible depth advances one step')
    }

    const style = label => row(label).evaluate(el => {
      const css = getComputedStyle(el)
      return [css.backgroundColor, css.outlineStyle]
    })
    await row('Level 7').locator('.workspace-layer-label').click()
    assert.deepEqual(await style('Level 7'), ['rgb(232, 244, 254)', 'none'])
    await row('Level 8').hover()
    assert.deepEqual(await style('Level 8'), ['rgb(244, 249, 255)', 'none'])
    assert.deepEqual(await style('Leaf'), ['rgb(244, 249, 255)', 'none'])
    const scroller = tree.locator('xpath=ancestor::*[contains(@class,"li-variables-layers")][1]')
    const viewport = await scroller.boundingBox()
    const parentBox = await row('Level 7').boundingBox()
    const childBox = await row('Level 8').boundingBox()
    assert.equal(childBox.y - parentBox.y - parentBox.height, 8)
    const gap = await h.page.screenshot({ clip: {
      x: Math.floor(viewport.x + viewport.width / 2), y: Math.floor(childBox.y - 4), width: 1, height: 1,
    }, scale: 'css' })
    const pixel = await h.page.evaluate(async image => {
      const source = await fetch('data:image/png;base64,' + image)
      const bitmap = await createImageBitmap(await source.blob())
      const ctx = new OffscreenCanvas(1, 1).getContext('2d')
      ctx.drawImage(bitmap, 0, 0)
      return [...ctx.getImageData(0, 0, 1, 1).data]
    }, gap.toString('base64'))
    assert.deepEqual(pixel, [244, 249, 255, 255], 'inherited selection continues through the inter-row gap')
    await item('Level 7').press('ArrowDown')
    assert.deepEqual(await style('Level 8'), ['rgb(244, 249, 255)', 'solid'])
    await item('Level 8').press('Enter')
    assert.deepEqual(await style('Level 8'), ['rgb(232, 244, 254)', 'solid'])
    await row('Leaf').locator('.workspace-layer-label').click()
    assert.deepEqual(await style('Leaf'), ['rgb(232, 244, 254)', 'none'])
    await row('Leaf').hover()
    await item('Leaf').getByRole('button', { name: 'Hide Leaf' }).click()
    assert.equal(await h.app.getByRole('button', { name: 'Leaf' }).isVisible(), false)
    await item('Leaf').getByRole('button', { name: 'Show Leaf' }).click()
    assert.equal(await h.app.getByRole('button', { name: 'Leaf' }).isVisible(), true)
    const collapse = h.page.getByRole('button', { name: 'Collapse layers', exact: true })
    await h.page.setViewportSize({ width: 1000, height: 400 })
    const beforeScroll = await collapse.boundingBox()
    const offsets = await scroller.evaluate(el => {
      el.scrollTo(el.scrollWidth, el.scrollHeight)
      return [el.scrollLeft, el.scrollTop]
    })
    assert.ok(offsets.every(offset => offset > 0), 'deep rows scroll in both directions')
    assert.deepEqual(await collapse.boundingBox(), beforeScroll)
    await collapse.click()
    await h.page.getByRole('button', { name: 'Expand layers', exact: true }).waitFor()
  } finally { await h.close() }
})

test('canvas selections reveal readable deep and shallow labels without moving the canvas', async () => {
  let deep = '<button id="deep" style="position:fixed;top:30px;left:60px">Report delivery</button>'
  for (let depth = 0; depth < 14; depth++) deep = '<section aria-label="Group ' + depth + '">' + deep + '</section>'
  const shallow = '<button id="shallow" style="position:fixed;top:80px;left:60px">Inbox</button>'
  const filler = '<p>Intermediate content</p>'.repeat(25)
  const h = await createHarness({ canvas: true, dock: true, flowPages: { '/': { body: shallow + filler + deep } } })
  try {
    await h.page.setViewportSize({width:1100,height:680})
    await h.open()
    const tree = h.page.getByRole('tree', {name:'Layers'})
    const pane = tree.locator('xpath=ancestor::*[contains(@class,"li-variables-layers")][1]')
    const scroll = () => pane.evaluate(el => [el.scrollLeft,el.scrollTop])
    async function check(id, name) {
      await h.app.locator(id).click({modifiers:['Meta']})
      const row = tree.getByRole('treeitem',{name,exact:true,selected:true})
      await row.waitFor()
      const label = row.locator(':scope > .workspace-layer-line > .workspace-layer-label')
      const position = await label.evaluate(el => {
        const pane = el.closest('.li-variables-layers')
        const rect = el.getBoundingClientRect(), view = pane.getBoundingClientRect()
        return { fullyVisible: rect.left >= view.left && rect.right <= view.left + pane.clientWidth * view.width / pane.offsetWidth &&
          rect.top >= view.top && rect.bottom <= view.top + pane.clientHeight * view.height / pane.offsetHeight,
          readable: el.clientWidth >= el.scrollWidth, treeFocused: pane.contains(pane.getRootNode().activeElement) }
      })
      assert.deepEqual(position,{fullyVisible:true,readable:true,treeFocused:false})
    }
    await check('#deep','Report delivery')
    const deepOffset = await scroll()
    assert.ok(deepOffset.every(value => value > 0), 'moved right and down')
    await check('#shallow','Inbox')
    const shallowOffset = await scroll()
    assert.ok(shallowOffset.every((value,i) => value < deepOffset[i]), 'moved left and up')
    await pane.evaluate(el => el.scrollTo(el.scrollWidth,el.scrollHeight))
    const browsed = await scroll()
    await h.app.locator('#shallow').evaluate(el => el.classList.add('refresh-layers'))
    await h.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.deepEqual(await scroll(),browsed,'ordinary tree updates preserve manual browsing')
    await check('#shallow','Inbox')
    // The workspace inverse-scales this panel during browser magnification.
    await h.page.locator('#workspace-sidebar').evaluate(el => {
      el.style.transformOrigin = 'top left'
      el.style.transform = 'scale(0.6)'
    })
    await check('#deep','Report delivery')
    await check('#shallow','Inbox')
    assert.deepEqual(await h.app.evaluate(() => [scrollX,scrollY]),[0,0])
  } finally { await h.close() }
})

test('Command-hover previews a layer, while selecting its label preserves disclosure', async () => {
  const body = '<section aria-label="Inbox folder"><div aria-label="Threads"><button id="unread">Unread</button></div></section>'
  const h = await createHarness({ canvas: true, dock: true, flowPages: { '/': { body } } })
  try {
    await h.open()
    const tree = h.page.getByRole('tree', { name: 'Layers' })
    const threads = tree.getByRole('treeitem', { name: 'Threads', exact: true })
    const line = threads.locator(':scope > .workspace-layer-line')
    await line.locator('.workspace-layer-label').click()
    assert.equal(await threads.getAttribute('aria-expanded'), 'false')
    assert.equal(await threads.getAttribute('data-selection'), 'direct')

    const target = h.app.locator('#unread')
    await target.hover()
    await h.page.keyboard.down('Meta')
    const leaf = tree.getByRole('treeitem', { name: 'Unread', exact: true })
    await tree.locator('[role="treeitem"][aria-label="Unread"][data-hovered]').waitFor({ timeout: 5000 })
    assert.equal(await threads.getAttribute('data-selection'), 'direct')
    await h.page.keyboard.up('Meta')
    await leaf.waitFor({ state: 'hidden' })
    assert.equal(await threads.getAttribute('aria-expanded'), 'false')

    await h.page.keyboard.down('Meta')
    await target.click({ modifiers: ['Meta'] })
    await h.page.keyboard.up('Meta')
    assert.equal(await leaf.getAttribute('data-selection'), 'direct')
    await line.locator('.workspace-layer-label').click()
    assert.equal(await threads.getAttribute('aria-expanded'), 'true')
    await line.locator('.workspace-layer-caret').click()
    assert.equal(await threads.getAttribute('aria-expanded'), 'false')
  } finally { await h.close() }
})
