import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

const source = 'src/styles/typography.css'
const textStyleCatalog = { source, names: ['--text-body', '--text-title', '--text-broken'] }
const appStyles = `
  :root {
    --text-body-font-family: Georgia, serif;
    --text-body-font-weight: 450;
    --text-body-font-size: 1rem;
    --text-body-line-height: 1.5;
    --text-body-letter-spacing: normal;
    --text-title-font-family: sans-serif;
    --text-title-font-weight: bold;
    --text-title-font-size: 24px;
    --text-title-line-height: normal;
    --text-title-letter-spacing: -0.02rem;
  }
  :root[data-theme="large"] { --text-body-font-size: 1.25rem; }
  .blocked { font-size: 12px !important; }
`
const setup = { textStyleCatalog, appStyles }
const button = (h, name) => h.host.getByRole('button', { name, exact: true })
const picker = h => h.host.getByRole('dialog', { name: 'Text styles' })
const search = h => picker(h).getByRole('combobox', { name: 'Search text styles' })
const option = (h, name) => picker(h).getByRole('option', { name: new RegExp(name.replace(/^--text-/, ''), 'i') })
const current = (h, name) => button(h, 'Text style ' + (name === '--text-body' ? 'Body' : 'Title'))
const layer = '#second-label'
const values = h => h.app.locator(layer).evaluate(node => {
  const style = getComputedStyle(node)
  return [style.fontFamily, style.fontWeight, style.fontSize, style.lineHeight, style.letterSpacing, style.color, style.textAlign]
})
const undo = async h => { await button(h, 'Undo last preview').click(); await h.settled() }
const open = async h => { await h.open(); await h.select(layer); await button(h, 'Apply text styles').click() }
const apply = async (h, name) => {
  await option(h, name).click()
  await current(h, name).waitFor({ state: 'visible' })
}
const go = async (h, path) => {
  await h.app.evaluate(path => history.pushState(null, '', path), path)
  await h.app.evaluate(() => window.phaseAInspectorReady)
}

test('text styles reuse the keyboard picker and replace, detach, compare and undo as a bundle', async () => {
  const h = await createHarness({ ...setup, dock: true })
  try {
    const before = await values(h)
    await open(h)
    assert.equal(await picker(h).getByRole('option').count(), 2)
    await search(h).fill('no such style')
    assert.equal(await picker(h).getByText('No styles match this search.').isVisible(), true)
    await search(h).press('Escape')
    assert.equal(await search(h).evaluate(node => node.value), '')
    await search(h).fill('body')
    await search(h).press('ArrowDown')
    await search(h).press('Enter')
    await current(h, '--text-body').waitFor()
    assert.deepEqual((await values(h)).slice(0, 5), ['Georgia, serif', '450', '16px', '24px', 'normal'])
    assert.deepEqual((await values(h)).slice(5), before.slice(5))
    assert.equal(await h.host.getByRole('spinbutton', { name: 'Font size' }).count(), 0)
    assert.equal((await h.journal()).length, 5)
    assert.equal(new Set((await h.journal()).map(entry => entry.group)).size, 1)

    await current(h, '--text-body').click()
    assert.equal(await option(h, 'body').getAttribute('aria-selected'), 'true')
    await apply(h, '--text-title')
    assert.deepEqual((await values(h)).slice(0, 4), ['sans-serif', '700', '24px', 'normal'])
    await button(h, 'Show original').click()
    assert.deepEqual(await values(h), before)
    await button(h, 'Show previews').click()
    await current(h, '--text-title').waitFor()
    const applied = await values(h)
    await h.host.getByRole('button', { name: 'Detach text style' }).focus()
    await button(h, 'Detach text style').press('Enter')
    await h.field('Font size').waitFor()
    assert.deepEqual(await values(h), applied)
    assert.equal(await h.app.locator(layer).evaluate(node => node.style.fontSize), '24px')
    await undo(h)
    await current(h, '--text-title').waitFor()
    await undo(h)
    await current(h, '--text-body').waitFor()
    await undo(h)
    assert.deepEqual(await values(h), before)
  } finally { await h.close() }
})

test('a failed style save rolls back all properties and leaves the picker retryable', async () => {
  const h = await createHarness({ ...setup, failSave: 1 })
  try {
    const before = await values(h)
    await open(h)
    await option(h, 'body').click()
    await picker(h).getByText('Could not apply text style. Try again.').waitFor()
    assert.deepEqual(await values(h), before)
    assert.deepEqual(await h.journal(), [])
    await apply(h, '--text-body')
    assert.equal((await h.journal()).length, 5)
  } finally { await h.close() }
})

test('a cascade conflict rolls back the bundle instead of saving a partial style', async () => {
  const h = await createHarness(setup)
  try {
    await h.app.locator(layer).evaluate(node => { node.className = 'blocked' })
    const before = await values(h)
    await open(h)
    await option(h, 'title').click()
    await picker(h).getByText('Could not apply text style. Try again.').waitFor()
    assert.deepEqual(await values(h), before)
    assert.deepEqual(await h.journal(), [])
    assert.equal(await h.app.locator(layer).evaluate(node => node.style.cssText), '')
  } finally { await h.close() }
})

test('a text style replays as a group across routes and follows live project tokens', async () => {
  const h = await createHarness(setup)
  try {
    const before = await values(h)
    await open(h)
    await apply(h, '--text-body')
    await h.app.evaluate(() => { document.documentElement.dataset.theme = 'large' })
    assert.deepEqual((await values(h)).slice(2, 4), ['20px', '30px'])
    await go(h, '/other')
    assert.deepEqual(await values(h), before)
    await go(h, '/')
    assert.deepEqual((await values(h)).slice(2, 4), ['20px', '30px'])
    await h.select(layer)
    await current(h, '--text-body').waitFor()
    await undo(h)
    assert.deepEqual(await values(h), before)
  } finally { await h.close() }
})

test('when a registered source is missing or unavailable the existing type inputs remain usable', async () => {
  for (const unavailable of [false, true]) {
    const h = await createHarness({ failTextStyleCatalog: unavailable })
    try {
      await open(h)
      await picker(h).getByText(unavailable ? 'The text style source is unavailable.' : 'No text style source connected.').waitFor()
      await search(h).press('Escape')
      await h.enter('Font size', 18)
      await h.settled()
      assert.equal((await values(h))[2], '18px')
    } finally { await h.close() }
  }
})

test('a failed replay after remount rolls back the style on every text target', async () => {
  const h = await createHarness(setup)
  try {
    await h.app.evaluate(() => {
      const group = document.createElement('div')
      group.id = 'article'
      group.style.padding = '8px'

      group.innerHTML = '<p id="first-copy">First copy</p><p id="second-copy">Second copy</p>'
      document.body.prepend(group)
    })
    await h.open()
    await h.select('#article')
    await button(h, 'Apply text styles').click()
    await apply(h, '--text-body')
    assert.equal(await h.css('font-family', '#first-copy'), 'Georgia, serif')
    await h.app.locator('#second-copy').evaluate(node => {
      const next = document.createElement('p')
      next.id = node.id
      next.textContent = node.textContent
      next.className = 'blocked'
      node.replaceWith(next)
    })
    await h.host.getByText(/Some saved previews could not be restored|The app changed a previewed style/).waitFor()
    assert.equal(await h.app.locator('#first-copy').evaluate(node => node.style.cssText), '')
    assert.equal(await h.css('font-size', '#second-copy'), '12px')
    await undo(h)
    assert.equal((await h.journal()).every(edit => edit.undone), true)
  } finally { await h.close() }
})

test('a text layer with inline runs retains the existing Typography controls', async () => {
  const h = await createHarness(setup)
  try {
    await h.app.locator(layer).evaluate(node => {
      node.innerHTML = 'Regular <span style="font-size:30px">Large</span>'
    })
    await h.open()
    await h.select(layer)
    assert.equal(await button(h, 'Apply text styles').count(), 0)
    assert.equal(await h.field('Font size').isVisible(), true)
    assert.equal(await h.css('font-size', layer + ' span'), '30px')
    assert.deepEqual(await h.journal(), [])
  } finally { await h.close() }
})
