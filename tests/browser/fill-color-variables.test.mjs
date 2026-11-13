import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

const source = 'src/styles/theme.css'
const options = {
  colorCatalog: { source, names: ['--secondary', '--other', '--missing', '--cycle', '--spacing'] },
  appStyles: `
    :root { --secondary: oklch(.8 .1 240); --other: var(--secondary); --cycle: var(--cycle); --spacing: 12px; }
    :root.dark { --secondary: oklch(.3 .1 240 / .6); --other: #123456; }
    :root.dark #target { background-color: #202020; }
  `,
}
const declaration = h => h.app.locator('#target').evaluate(node => node.style.backgroundColor)
const chip = (h, name = 'secondary') => h.host.getByRole('button', { name: 'Fill variable ' + name, exact: true })
const picker = h => h.host.getByRole('dialog', { name: 'Variables' })
const option = (h, name) => picker(h).getByRole('option', { name, exact: true })
const trigger = h => h.host.getByRole('button', { name: 'Fill variables' })
const undo = h => h.host.getByRole('button', { name: 'Undo', exact: false }).click()

test('a real Fill binding retains its named declaration across theme, replacement, detach and undo', async () => {
  const h = await createHarness({ ...options, dock: true })
  try {
    await h.open()
    await h.select()
    await trigger(h).click()
    assert.equal(await picker(h).getByRole('option').count(), 2)
    await option(h, 'secondary').click()
    await h.settled()
    assert.equal(await declaration(h), 'var(--secondary)')
    assert.equal(await h.css('background-color'), 'oklch(0.8 0.1 240)')
    assert.deepEqual((await h.journal())[0].colorToken, { name: '--secondary', source })
    assert.equal(await option(h, 'secondary').getAttribute('aria-selected'), 'true')
    assert.equal(await trigger(h).getAttribute('aria-expanded'), 'true')
    await picker(h).getByRole('combobox').press('Escape')
    await h.app.evaluate(() => document.documentElement.classList.add('dark'))
    assert.equal(await h.css('background-color'), 'oklch(0.3 0.1 240 / 0.6)')
    assert.equal(await declaration(h), 'var(--secondary)')
    const compare = h.host.locator('#clear')
    await compare.click()
    await h.settled()
    assert.equal(await h.css('background-color'), 'rgb(32, 32, 32)')
    assert.equal(await compare.getAttribute('aria-pressed'), 'true')
    await compare.click()
    await h.settled()
    assert.equal(await declaration(h), 'var(--secondary)')
    await chip(h).click()
    assert.equal(await option(h, 'secondary').getAttribute('aria-selected'), 'true')
    await option(h, 'other').click()
    await h.settled()
    assert.equal(await declaration(h), 'var(--other)')
    assert.equal(await option(h, 'other').getAttribute('aria-selected'), 'true')
    await picker(h).getByRole('combobox').press('Escape')
    await undo(h)
    await h.settled()
    assert.equal(await declaration(h), 'var(--secondary)')

    await chip(h).hover()
    await h.host.getByRole('button', { name: 'Detach fill variable' }).click()
    await h.settled()
    assert.equal(await declaration(h), 'oklch(0.3 0.1 240 / 0.6)')
    const fill = h.host.getByRole('textbox', { name: 'Fill color' })
    assert.match(await fill.inputValue(), /^[0-9A-F]{6}99$/)
    assert.equal(await fill.getAttribute('title'), 'oklch(0.3 0.1 240 / 0.6)')
    assert.equal((await h.journal()).at(-1).colorToken, undefined)
    await undo(h)
    await h.settled()
    assert.equal(await declaration(h), 'var(--secondary)')
    await undo(h)
    await h.settled()
    assert.equal(await declaration(h), '')
    assert.equal(await h.css('background-color'), 'rgb(32, 32, 32)')
  } finally { await h.close() }
})

test('a rejected binding leaves the prior Fill, picker focus and journal intact', async () => {
  const h = await createHarness({ ...options, failSave: 1 })
  try {
    await h.open()
    await h.select()
    await trigger(h).click()
    await option(h, 'secondary').click()
    await h.settled()
    assert.equal(await declaration(h), '')
    assert.equal(await option(h, 'secondary').getAttribute('aria-selected'), 'false')
    assert.match(await picker(h).getByText('Could not apply color. Try again.').innerText(), /Could not apply/)
    assert.deepEqual(await h.journal(), [])
    await option(h, 'secondary').click()
    await h.settled()
    assert.equal(await declaration(h), 'var(--secondary)')
  } finally { await h.close() }
})

test('a saved name replays only with an available source and a unique compatible target', async () => {
  const edit = {
    id: '61114ab7-33c2-401e-9c4e-a39bb0e27bf8', route: '/',
    target: { id: 'target', tag: 'div', slot: null, text: 'One Two' },
    property: 'background-color', requested: 'var(--secondary)', observed: 'oklch(0.8 0.1 240)',
    before: 'rgb(255, 255, 255)', restore: 'unique', colorToken: { name: '--secondary', source },
  }
  const h = await createHarness({ ...options, journal: [edit] })
  try {
    assert.equal(await declaration(h), 'var(--secondary)')
    await h.open()
    await h.select()
    assert.equal(await chip(h).count(), 1)
    await h.app.evaluate(async () => {
      history.pushState({}, '', '/other')
      await window.phaseAInspectorReady
      const target = document.getElementById('target')
      target.id = 'renamed'
      const lookalike = target.cloneNode(true)
      lookalike.id = 'target'
      lookalike.innerText = 'Different target'
      target.after(lookalike)
      history.pushState({}, '', '/')
      await window.phaseAInspectorReady
    })
    assert.equal(await declaration(h), '')
    assert.equal(await h.host.getByText('Some saved previews could not be restored.').count(), 1)
  } finally { await h.close() }
  const unavailable = await createHarness({ journal: [edit] })
  try {
    assert.equal(await declaration(unavailable), '')
    await unavailable.open()
    await unavailable.select()
    assert.equal(await trigger(unavailable).count(), 0)
    assert.equal(await unavailable.host.getByRole('textbox', { name: 'Fill color' }).inputValue(), 'FFFFFF')
  } finally { await unavailable.close() }
})
