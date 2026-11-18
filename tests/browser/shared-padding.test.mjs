import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

async function openRows(h) {
  await h.app.evaluate(() => {
    const list = document.createElement('section')
    const markup = [
      ['a', 'Amelia Chen', true], ['b', 'Jordan Lee', true],
      ['c', 'Marcus Reed', true], ['d', 'Priya Shah', false],
    ]
    for (const [key, name, shared] of markup) {
      const row = document.createElement('div')
      row.id = key
      row.setAttribute('role', 'row')
      row.dataset.inspectorTarget = 'users-' + key
      if (shared) row.dataset.inspectorSharedVerticalPadding = 'users-list'
      row.textContent = name
      row.style.cssText = 'display: flex; padding: 6px 12px'
      list.append(row)
    }
    document.body.prepend(list)
  })
  await h.open()
  await h.select('#b')
}

const values = h => Promise.all(['a', 'b', 'c', 'd'].flatMap(id =>
  ['top', 'bottom'].map(side => h.css('padding-' + side, '#' + id)),
))
const original = Array(8).fill('6px')
const shared = [...Array(6).fill('12px'), '6px', '6px']

test('shared padding outlines are transient and the grouped preview undoes together in the dock', async () => {
  const h = await createHarness({ dock: true })
  try {
    await openRows(h)
    const scope = h.host.getByRole('button', { name: 'Show 3 affected rows' })
    const related = h.app.locator('#localhost-inspector-outlines .li-outline-related')
    await scope.hover()
    await related.nth(1).waitFor()
    assert.equal(await related.count(), 2)
    await h.host.getByRole('button', { name: 'Collapse Inspector' }).hover()
    await related.first().waitFor({ state: 'detached' })
    assert.equal(await h.app.locator('#localhost-inspector-outlines #outline').isVisible(), true)
    await scope.focus()
    await related.nth(1).waitFor()
    await scope.press('Escape')
    await related.first().waitFor({ state: 'detached' })

    await h.enter('Vertical padding', 12)
    await h.settled()
    assert.deepEqual(await values(h), shared)
    const edits = await h.journal()
    assert.equal(edits.length, 6)
    assert.equal(new Set(edits.map(edit => edit.group)).size, 1)
    assert.deepEqual(edits.slice(0, 2).map(edit => edit.target.key), ['users-b', 'users-b'])

    const compare = h.host.getByRole('button', { name: 'Show original' })
    await compare.click()
    await h.settled()
    assert.deepEqual(await values(h), original)
    await h.host.getByRole('button', { name: 'Show previews' }).click()
    await h.settled()
    assert.deepEqual(await values(h), shared)
    await h.host.getByRole('button', { name: 'Undo last preview' }).click()
    await h.settled()
    assert.deepEqual(await values(h), original)
    assert.deepEqual(await h.journal(), [])
  } finally { await h.close() }
})

test('failed saves roll back every row and missing ownership keeps edits on the selected row', async () => {
  const h = await createHarness({ failSave: 1 })
  try {
    await openRows(h)
    await h.enter('Vertical padding', 12)
    await h.settled()
    assert.deepEqual(await values(h), original)
    assert.deepEqual(await h.journal(), [])
    await h.app.locator('#c').evaluate(node => node.removeAttribute('data-inspector-target'))
    await h.host.getByRole('button', { name: 'Show 3 affected rows' }).waitFor({ state: 'detached' })
    assert.equal(await h.host.getByText('This row only in preview').isVisible(), true)
    await h.enter('Vertical padding', 12)
    await h.settled()
    assert.deepEqual(await values(h), ['6px', '6px', '12px', '12px', '6px', '6px', '6px', '6px'])
    assert.equal(await h.host.getByText('This row only in preview').isVisible(), true)
  } finally { await h.close() }
})

test('a saved shared preview detaches as a group when its registered scope changes', async () => {
  const h = await createHarness()
  try {
    await openRows(h)
    await h.enter('Vertical padding', 12)
    await h.settled()
    await h.app.locator('#c').evaluate(node => node.removeAttribute('data-inspector-shared-vertical-padding'))
    await h.host.getByText('Some saved previews could not be restored.').waitFor()
    assert.deepEqual(await values(h), original)
    await h.app.locator('#c').evaluate(node => { node.dataset.inspectorSharedVerticalPadding = 'users-list' })
    await h.page.waitForFunction(() => getComputedStyle(document.querySelector('#c')).paddingTop === '12px')
    assert.deepEqual(await values(h), shared)
  } finally { await h.close() }
})

test('native table row padding explains its owner and jumps to the chosen editable cell', async () => {
  const h = await createHarness({ dock: true })
  try {
    await h.app.evaluate(() => {
      const table = document.createElement('table')
      const heading = table.createTHead().insertRow()
      for (const name of ['Task', 'Status']) {
        const cell = document.createElement('th')
        cell.textContent = name
        heading.append(cell)
      }
      const row = table.createTBody().insertRow()
      row.id = 'native-row'
      for (const [id, name] of [['first-cell', 'Task'], ['second-cell', 'Status']]) {
        const cell = row.insertCell()
        cell.id = id
        cell.textContent = name
        cell.style.padding = '6px 12px'
      }
      document.body.prepend(table)
    })
    await h.open()
    await h.select('#second-cell')
    await h.host.getByRole('button', { name: 'Select parent element' }).click()
    assert.equal(await h.field('Vertical padding').count(), 0)
    const field = h.host.getByRole('button', { name: 'Vertical padding' })
    const menu = h.host.getByRole('menu', { name: 'Vertical padding' })
    const outline = h.app.locator('#localhost-inspector-outlines #outline')
    const preview = h.app.locator('#localhost-inspector-outlines #hover-outline')
    const status = menu.getByRole('menuitem', { name: 'Status cell', exact: true })
    await field.focus()
    await field.press('Enter')
    assert.equal(await menu.getByText('Padding is set on the cells.').isVisible(), true)
    assert.deepEqual(await menu.getByRole('menuitem').allTextContents(), ['Task cell', 'Status cell'])
    const anchorBox = await field.boundingBox()
    assert.ok((await menu.boundingBox()).y >= anchorBox.y + anchorBox.height)
    await preview.waitFor()
    assert.ok((await preview.boundingBox()).width < (await outline.boundingBox()).width)
    await h.page.keyboard.press('Escape')
    await menu.waitFor({ state: 'detached' })
    await preview.waitFor({ state: 'hidden' })
    assert.equal(await field.evaluate(node => node.getRootNode().activeElement === node), true)
    assert.deepEqual(await h.journal(), [])

    await field.click()
    await status.click()
    await h.enter('Vertical padding', 16)
    await h.settled()
    assert.equal(await h.css('padding-top', '#second-cell'), '16px')
    assert.equal(await h.css('padding-top', '#first-cell'), '6px')
    assert.equal(await h.css('padding-top', '#native-row'), '0px')
    assert.deepEqual((await h.journal()).map(edit => edit.target.id), ['second-cell', 'second-cell'])

    await h.host.getByRole('button', { name: 'Select parent element' }).click()
    await field.click()
    await status.hover()
    const statusBounds = await h.app.locator('#second-cell').boundingBox()
    assert.equal(Math.round((await preview.boundingBox()).x - statusBounds.x), 2)
    await h.app.locator('#second-cell').evaluate(cell => cell.remove())
    await menu.waitFor({ state: 'detached' })
    await preview.waitFor({ state: 'hidden' })
    assert.equal(await outline.isVisible(), true)
    await field.click()
    assert.equal(await menu.getByRole('menuitem', { name: 'Padding is on Cell 1' }).isVisible(), true)
    await h.app.locator('#first-cell').evaluate(cell => cell.remove())
    await menu.waitFor({ state: 'detached' })
    await field.click()
    assert.equal(await menu.getByText(/No cells available/).isVisible(), true)
    assert.equal(await menu.getByRole('menuitem').count(), 0)
  } finally { await h.close() }
})
