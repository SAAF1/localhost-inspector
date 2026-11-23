import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

test('Variables saves a text style definition without applying it to the app', async () => {
  const h = await createHarness({
    canvas: true, dock: true,
    textStyleCatalog: { source: 'theme.css', names: [], canCreate: true, canCreateDefinition: true },
  })
  try {
    await h.open()
    const sidebar = h.page.locator('#workspace-sidebar')
    await sidebar.getByRole('button', { name: 'Variables', exact: true }).click()
    const openBold = () => sidebar.locator('button.li-type-body').filter({ hasText: 'Bold' }).click()
    await openBold()
    const detailsButton = sidebar.getByRole('button', { name: 'View typography details for Bold', exact: true })
    await detailsButton.locator('..').hover()
    await detailsButton.click()
    const details = sidebar.getByRole('dialog', { name: 'Typography details' })
    const openForm = () => details.getByRole('button', { name: 'Create text style', exact: true }).click()
    await openForm()
    const form = h.host.getByRole('dialog', { name: 'Create new text style' })
    await form.waitFor()
    assert.deepEqual(await h.app.evaluate(() => window.__textStyleDefinitions), [])
    await form.getByRole('button', { name: 'Back to typography details' }).click()
    await details.waitFor()
    await openForm()
    await form.getByRole('button', { name: 'Close text style form' }).click()
    await form.waitFor({ state: 'detached' })
    await details.waitFor({ state: 'detached' })

    await detailsButton.locator('..').hover()
    await detailsButton.click()
    await openForm()
    await form.getByRole('textbox', { name: 'Name' }).fill('Large label')
    await form.getByRole('textbox', { name: 'Description' }).fill('Large label for a compact card')
    await form.getByRole('button', { name: 'Create style', exact: true }).click()
    await sidebar.getByRole('status').filter({ hasText: 'Text style created.' }).waitFor()
    await sidebar.getByRole('button', { name: 'Back', exact: true }).click()
    const [definition] = await h.app.evaluate(() => window.__textStyleDefinitions)
    assert.equal(definition.name, '--text-large-label')
    assert.equal(definition.values['font-size'], '32px')
    assert.equal(definition.description, 'Large label for a compact card')
    assert.deepEqual(await h.journal(), [])
    assert.equal(await h.app.locator('#second-label').getAttribute('style'), null)
    assert.equal(await h.css('font-size', '#second-label'), '32px')

    const row = sidebar.locator('.li-type-row').filter({ hasText: 'Large label' })
    assert.equal(await row.locator('.li-var-count').textContent(), '0')

    await openBold()
    await detailsButton.click()
    await openForm()
    await form.getByRole('textbox', { name: 'Name' }).fill('Large label')
    await form.getByRole('button', { name: 'Create style', exact: true }).click()
    await form.getByRole('alert').filter({ hasText: 'That style name is already in use.' }).waitFor()
    assert.equal(await form.getByRole('textbox', { name: 'Name' }).getAttribute('aria-invalid'), 'true')
    assert.deepEqual(await h.app.evaluate(() => window.__textStyleDefinitions), [definition])
    await sidebar.getByRole('button', { name: 'File', exact: true }).click()
    await form.waitFor({ state: 'detached' })

    await h.select('#second-label')
    await h.host.getByRole('button', { name: 'Text style Large label' }).click()
    await h.host.getByRole('dialog', { name: 'Text styles' }).getByRole('option', { name: /Large label/ }).waitFor()
  } finally { await h.close() }
})
