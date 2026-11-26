import assert from 'node:assert/strict'
import test from 'node:test'
import { createHarness } from './harness.mjs'

const otherEdit = {
  id: 'other-route', route: '/users', target: { tag: 'button', id: 'other', slot: null },
  property: 'border-radius', before: '0px', requested: '4px', observed: '4px', restore: 'unique',
}
const groupedEdits = [
  { ...otherEdit, id: 'padding-top', group: 'padding-top', property: 'padding-top', requested: '16px' },
  { ...otherEdit, id: 'padding-bottom', group: 'padding-top', property: 'padding-bottom', requested: '16px' },
]

test('Design and Edits use the rendered button label and preserve explicit labels', async () => {
  const h = await createHarness({ pendingEdits: true })
  try {
    const button = h.app.locator('#other')
    await button.evaluate(node => { node.innerHTML = 'Save<span hidden>Internal helper</span>' })
    await h.open()
    await h.select('#other')
    assert.equal(await h.host.locator('#selected-name').innerText(), 'Save')
    await h.enter('Corner radius', 12)
    await h.settled()
    await h.host.getByRole('tab', { name: 'Edits 1' }).click()
    assert.equal(await h.host.locator('.li-pending-name').innerText(), 'Save')
    await button.evaluate(node => node.setAttribute('aria-label', 'Save draft'))
    await h.host.getByRole('tab', { name: 'Design' }).click()
    await h.select('#other')
    assert.equal(await h.host.locator('#selected-name').innerText(), 'Save draft')
    await h.host.getByRole('tab', { name: 'Edits 1' }).click()
    assert.equal(await h.host.locator('.li-pending-name').innerText(), 'Save draft')
  } finally { await h.close() }
})

test('pending operations stay visible across pages and removing a middle value preserves the final preview', async () => {
  const h = await createHarness({ pendingEdits: true, journal: [otherEdit, ...groupedEdits] })
  try {
    await h.open()
    await h.select()
    await h.enter('Corner radius', 8)
    await h.settled()
    await h.enter('Corner radius', 12)
    await h.settled()
    await h.enter('Corner radius', 16)
    await h.settled()

    await h.host.getByRole('tab', { name: 'Edits 5' }).click()
    const scope = h.host.locator('#pending-view')
    assert.equal(await scope.getByText('5 pending edits', { exact: true }).isVisible(), false)
    assert.deepEqual(await scope.getByRole('heading').allTextContents(), ['Users', 'Home'])
    assert.equal(await scope.getByRole('button', { name: /Vertical padding/ }).count(), 1)
    const middle = scope.getByRole('button', { name: /8px → 12px/ })
    const remove = middle.locator('..').getByRole('button', { name: /Remove/ })
    const opacity = () => remove.evaluate(button => getComputedStyle(button).opacity)
    assert.equal(await opacity(), '0')
    await remove.focus()
    assert.equal(await opacity(), '1')
    await middle.hover()
    assert.equal(await opacity(), '1')
    await h.host.locator('#hover-outline').waitFor({ state: 'hidden' })
    await h.host.locator('#outline').waitFor()
    await remove.click()
    await h.host.getByRole('tab', { name: 'Edits 4' }).waitFor()
    assert.equal(await h.css('border-radius'), '16px')
    assert.deepEqual((await h.journal()).slice(-2).map(edit => [edit.before, edit.requested]),
      [['0px', '8px'], ['8px', '16px']])

    const sort = scope.getByRole('button', { name: 'Sort pending edits: By page' })
    const menu = h.host.getByRole('menu', { name: 'Sort pending edits' })
    await sort.press('ArrowDown')
    assert.equal(await menu.getByRole('menuitemradio', { name: 'By page', checked: true }).count(), 1)
    assert.ok((await menu.boundingBox()).y > (await sort.boundingBox()).y + (await sort.boundingBox()).height)
    await h.page.keyboard.press('Escape')
    await menu.waitFor({ state: 'hidden' })
    assert.equal(await sort.evaluate(button => button.getRootNode().activeElement === button), true)
    await sort.press('ArrowDown')
    await h.page.keyboard.press('ArrowDown')
    await h.page.keyboard.press('Enter')
    assert.equal(await scope.getByRole('button', { name: 'Sort pending edits: Most recent' }).isVisible(), true)
    assert.match(await scope.locator('.li-pending-open').first().innerText(), /Home · Corner radius.*8px → 16px/)
    await scope.getByRole('button', { name: /8px → 16px/ }).click()
    await h.host.locator('#outline').waitFor()
    assert.match(await scope.locator('[data-selected]').innerText(), /8px → 16px/)

    // Simulate the existing agent completion command changing the journal.
    await h.app.evaluate(() => {
      window.__journal = window.__journal.filter(edit => edit.route === '/users')
      window.__revision++
    })
    await h.host.getByRole('tab', { name: 'Design' }).click()
    await h.host.getByRole('tab', { name: 'Edits 4' }).click()
    await h.host.getByRole('tab', { name: 'Edits 2' }).waitFor()
    assert.equal(await h.css('border-radius'), '0px')
  } finally { await h.close() }
})

test('compact pending review works in Localhost and Canvas, and zoom changes the actual Canvas', async () => {
  const h = await createHarness({ pendingEdits: true, dock: true, canvas: true })
  try {
    const launcher = h.page.locator('#pending-toggle')
    assert.equal(await launcher.isHidden(), true)
    await h.open()
    await h.select()
    await h.enter('Corner radius', 8)
    await h.settled()
    await h.page.getByRole('button', { name: 'Collapse Inspector', exact: true }).click()
    assert.equal(await launcher.innerText(), '1')
    await launcher.click()
    const pending = h.host.getByRole('region', { name: 'Pending edits', exact: true })
    assert.equal(await pending.getByText('1 pending edit', { exact: true }).count(), 0)
    const actions = pending.getByRole('group', { name: 'Preview actions' })
    await actions.getByRole('button', { name: 'Show original' }).click()
    await h.settled()
    assert.equal(await h.css('border-radius'), '0px')
    await actions.getByRole('button', { name: 'Show previews' }).click()
    await h.settled()
    assert.equal(await h.css('border-radius'), '8px')
    const edit = h.host.getByRole('button', { name: /Corner radius.*0px → 8px/ })
    await edit.hover()
    await h.app.locator('#localhost-inspector-outlines #hover-outline').waitFor()
    await h.page.keyboard.press('Escape')
    await h.host.locator('#pending-view').waitFor({ state: 'hidden' })
    await h.page.getByRole('button', { name: 'Expand flow', exact: true }).click()
    await launcher.click()
    assert.equal(await actions.getByRole('button', { name: 'Undo last preview' }).isVisible(), true)
    await edit.waitFor()
    await edit.click()
    await h.app.locator('#localhost-inspector-outlines #outline').waitFor()
    const zoom = h.page.getByRole('combobox', { name: 'Canvas zoom' })
    await zoom.selectOption('0.5')
    assert.match(await h.page.locator('#map').evaluate(node => node.style.transform), /scale\(0.5\)/)
    await zoom.selectOption('fit')
    assert.doesNotMatch(await h.page.locator('#map').evaluate(node => node.style.transform), /scale\(0.5\)/)
  } finally { await h.close() }
})

test('clicking a pending edit centers its Canvas frame at 90% even when its element cannot be restored', async () => {
  const journal = [
    { ...otherEdit, id: 'home-edit', route: '/', restore: 'ambiguous' },
    { ...otherEdit, restore: 'ambiguous', requested: '6px' },
  ]
  const flowFrames = [
    { id: 'home', route: '/', label: 'Home', steps: [], checkpoint: [], image: 'home.png' },
    { id: 'users', route: '/users', label: 'Users', steps: [], checkpoint: [], image: 'users.png' },
  ]
  const h = await createHarness({ dock: true, canvas: true, pendingEdits: true, flowFrames, journal })
  try {
    await h.page.getByRole('button', { name: 'Expand flow' }).click()
    await h.open()
    await h.showEdits()
    const viewport = h.page.locator('#viewport')
    const frame = h.page.locator('#app-preview')
    const dock = h.page.locator('#localhost-inspector-dock')
    const zoom = h.page.getByRole('combobox', { name: 'Canvas zoom' })
    const assertCentered = async () => {
      const [bounds, canvas, inspector] = await Promise.all([frame.boundingBox(), viewport.boundingBox(), dock.boundingBox()])
      assert.ok(Math.abs(bounds.x + bounds.width / 2 - (canvas.x + (canvas.width - inspector.width) / 2)) <= 1)
    }
    await viewport.dispatchEvent('wheel', { deltaX: 1600, deltaY: 900, bubbles: true, cancelable: true })
    assert.ok((await frame.boundingBox()).x - (await viewport.boundingBox()).x < -1000)
    await h.host.getByRole('button', { name: /0px → 4px/ }).click()
    await h.host.locator('#pending-status').getByText('The original element is no longer available. This preview applies only to that element.', { exact: true }).waitFor()
    assert.equal(await zoom.locator('option:checked').textContent(), '90%')
    await assertCentered()
    await zoom.selectOption('0.5')
    await h.host.getByRole('button', { name: /0px → 6px/ }).click()
    await h.page.locator('[data-frame="users"][aria-pressed="true"]').waitFor()
    assert.equal(await frame.getAttribute('src'), '/users')
    await h.page.waitForFunction(() => document.querySelector('#zoom-preset').selectedOptions[0]?.textContent === '90%')
    await assertCentered()
    assert.equal(await h.page.getByRole('button', { name: 'Back to localhost' }).isVisible(), true)
  } finally { await h.close() }
})

test('clicking an edit for another Localhost route opens it and selects the restored element', async () => {
  const h = await createHarness({ pendingEdits: true })
  try {
    await h.app.evaluate(() => { location.hash = '/users' })
    await h.app.evaluate(() => window.phaseAInspectorReady)
    await h.open()
    await h.select()
    await h.enter('Corner radius', 4)
    await h.settled()
    await h.app.evaluate(() => { location.hash = '' })
    await h.app.evaluate(() => window.phaseAInspectorReady)
    await h.showEdits()
    await h.host.getByRole('button', { name: /Corner radius/ }).click()
    await h.page.waitForURL('**/#/users')
    await h.host.locator('#pending-list [data-selected]').waitFor()
    await h.host.locator('#outline').waitFor()
    assert.equal(await h.css('border-radius'), '4px')
  } finally { await h.close() }
})

for (const canvas of [false, true]) {
  test('a fresh ' + (canvas ? 'Canvas' : 'Localhost') + ' edit can locate its element while showing Original', async () => {
    const h = await createHarness({ pendingEdits: true, canvas, dock: canvas })
    try {
      if (canvas) await h.page.getByRole('button', { name: 'Expand flow' }).click()
      await h.open()
      await h.select()
      await h.enter('Corner radius', 14)
      await h.settled()
      await h.showEdits()
      await h.previewAction('Show original')
      assert.equal(await h.css('border-radius'), '0px')
      await h.host.getByRole('button', { name: /Corner radius/ }).click()
      await h.host.locator('#pending-list [data-selected]').waitFor({ timeout: 1500 })
      assert.equal(await h.css('border-radius'), '0px')
    } finally { await h.close() }
  })
}

test('a saved control with a changed baseline can still be located without replaying the preview', async () => {
  const h = await createHarness({ pendingEdits: true })
  try {
    await h.app.evaluate(() => {
      document.querySelector('#target').insertAdjacentHTML('afterend',
        '<main><section><button style="border-radius: 6px">Publish report</button></section></main>' +
        '<aside><button style="border-radius: 8px">Publish report</button></aside>')
    })
    const go = async path => {
      await h.app.evaluate(path => history.pushState(null, '', path), path)
      await h.app.evaluate(() => window.phaseAInspectorReady)
    }
    await h.open()
    await h.select('main button')
    await h.enter('Corner radius', 14)
    await h.settled()
    await go('/other')
    await h.app.locator('main button').evaluate(node => {
      const replacement = node.cloneNode(true)
      replacement.style.borderRadius = '8px'
      node.replaceWith(replacement)
    })
    await go('/')
    await h.showEdits()
    await h.host.getByRole('button', { name: /Corner radius/ }).click()
    await h.host.locator('#pending-list [data-selected]').waitFor({ timeout: 1500 })
    assert.deepEqual(await h.host.locator('#outline').boundingBox(), await h.app.locator('main button').boundingBox())
    assert.equal(await h.css('border-radius', 'main button'), '8px')
    assert.equal(await h.css('border-radius', 'aside button'), '8px')
  } finally { await h.close() }
})

test('a fresh Canvas edit reopens its recorded dialog instead of the base frame on the same route', async () => {
  const flowFrames = [
    { id: 'home', route: '/', label: 'Home', steps: [], checkpoint: [], image: 'home.png' },
    { id: 'share', route: '/', label: 'Share link', steps: [{ role: 'button', label: 'Share' }],
      checkpoint: [{ role: 'dialog', label: 'Share link' }], image: 'share.png' },
  ]
  const h = await createHarness({
    pendingEdits: true, dock: true, canvas: true, flowFrames,
    flowPages: { '/': { body: '<button onclick="sharing.hidden=false">Share</button>' +
      '<section id="sharing" role="dialog" aria-label="Share link" hidden><p id="share-description">Send a link</p></section>' } },
  })
  try {
    const flow = h.page.locator('#flow-toggle')
    await h.app.getByRole('button', { name: 'Share', exact: true }).click()
    await flow.click()
    await h.page.locator('[data-frame="share"][aria-pressed="true"]').waitFor()
    await h.open()
    await h.select('#share-description')
    await h.enter('Font size', 20)
    await h.settled()
    const [edit] = await h.journal()
    assert.match(edit.frameState, /^[0-9a-f]{64}$/)

    await flow.click()
    await h.app.locator('#sharing').evaluate(node => { node.hidden = true })
    await flow.click()
    await h.page.locator('[data-frame="home"][aria-pressed="true"]').waitFor()
    await h.showEdits()
    await h.host.getByRole('button', { name: /Text size/ }).click()
    await h.page.locator('[data-frame="share"][aria-pressed="true"]').waitFor()
    await h.page.frameLocator('#app-preview').getByRole('dialog', { name: 'Share link' }).waitFor()
  } finally { await h.close() }
})

test('an edit without a durable target keeps its live preview when another page changes the journal', async () => {
  const h = await createHarness({ pendingEdits: true })
  const selector = '#target > span:first-child'
  try {
    await h.open()
    await h.select(selector)
    await h.enter('Font size', 18)
    await h.settled()
    assert.equal(await h.css('font-size', selector), '18px')
    await h.host.getByText('Some previews last only while this page stays open.').waitFor()
    await h.app.evaluate(edit => {
      window.__journal.push({ ...edit, restore: 'ambiguous' })
      window.__revision++
    }, otherEdit)

    await h.host.getByRole('tab', { name: 'Edits 1', exact: true }).click()
    await h.host.getByRole('tab', { name: 'Edits 2', exact: true }).waitFor()
    assert.equal(await h.css('font-size', selector), '18px')
    const current = h.host.getByRole('button', { name: /Text size.*12px → 18px/ })
    assert.equal(await current.isEnabled(), true)
    const other = h.host.getByRole('button', { name: /Corner radius/ })
    assert.equal(await other.isEnabled(), true)
    assert.equal(await h.host.getByText('Preview only in original page session').count(), 0)

    await h.host.locator('#clear').click()
    await h.host.getByText('Original view', { exact: true }).waitFor()
    await h.host.locator('#clear').click()
    await h.settled()
    assert.equal(await h.css('font-size', selector), '18px')

    for (const path of ['/other', '/']) {
      await h.app.evaluate(path => history.pushState(null, '', path), path)
      await h.app.evaluate(() => window.phaseAInspectorReady)
    }
    assert.equal(await h.css('font-size', selector), '12px')
    await current.click()
    await h.host.locator('#pending-status').getByText('The original element is no longer available. This preview applies only to that element.', { exact: true }).waitFor()
    assert.equal((await h.journal()).length, 2)
  } finally { await h.close() }
})

test('the pending edits sort works by touch in docked and collapsed views', async () => {
  const journal = Array.from({ length: 12 }, (_, index) => ({ ...otherEdit, id: 'other-' + index }))
  const h = await createHarness({ pendingEdits: true, dock: true, canvas: true, hasTouch: true, journal })
  try {
    await h.page.getByRole('button', { name: 'Open Inspector', exact: true }).tap()
    await h.host.getByRole('tab', { name: 'Edits 12' }).tap()
    const view = h.host.locator('#pending-view')
    const menu = h.host.getByRole('menu', { name: 'Sort pending edits' })
    assert.equal(await view.getByText('12 pending edits', { exact: true }).isVisible(), false)
    assert.equal(await view.getByRole('button', { name: /Remove/ }).first()
      .evaluate(button => getComputedStyle(button).opacity), '1')
    await view.getByRole('button', { name: 'Sort pending edits: By page' }).tap()
    await menu.getByRole('menuitemradio', { name: 'Most recent' }).tap()
    await menu.waitFor({ state: 'hidden' })
    assert.equal(await view.getByRole('heading', { name: 'Users' }).count(), 0)
    await h.page.getByRole('button', { name: 'Collapse Inspector', exact: true }).tap()
    await h.page.locator('#pending-toggle').tap()
    assert.equal(await view.getByText('12 pending edits', { exact: true }).count(), 0)
    const sort = view.getByRole('button', { name: 'Sort pending edits: Most recent' })
    await sort.tap()
    assert.equal(await menu.getByRole('menuitemradio', { name: 'Most recent', checked: true }).isVisible(), true)
    await sort.tap()
    await menu.waitFor({ state: 'hidden' })
    assert.equal(await view.isVisible(), true)
    await sort.tap()
    await menu.getByRole('menuitemradio', { name: 'By page' }).tap()
    assert.equal(await view.getByRole('heading', { name: 'Users' }).isVisible(), true)
  } finally { await h.close() }
})

test('removing a live unkeyed edit preserves newer changes to that same setting', async () => {
  const h = await createHarness({ pendingEdits: true })
  const selector = '#target > span:first-child'
  try {
    await h.open()
    await h.select(selector)
    await h.enter('Font size', 18)
    await h.settled()
    await h.enter('Font size', 20)
    await h.settled()
    await h.host.getByRole('tab', { name: 'Edits 2' }).click()
    const remove = async value => {
      const row = h.host.locator('.li-pending-row').filter({ hasText: value })
      await row.hover()
      await row.getByRole('button', { name: /Remove/ }).click()
    }
    await remove('12px → 18px')
    await h.host.locator('#pending-status').getByText('A newer live preview changes the same setting. Remove the newer edit first.').waitFor()
    assert.equal(await h.css('font-size', selector), '20px')
    assert.equal((await h.journal()).length, 2)
    await remove('18px → 20px')
    await h.host.getByRole('tab', { name: 'Edits 1' }).waitFor()
    assert.equal(await h.css('font-size', selector), '18px')
    await remove('12px → 18px')
    await h.host.getByText('No pending edits', { exact: true }).waitFor()
    assert.equal(await h.css('font-size', selector), '12px')
  } finally { await h.close() }
})

test('a pending eye toggles only its saved operation and preserves later layers and comparison', async () => {
  const h = await createHarness({ pendingEdits: true })
  try {
    await h.open()
    await h.select()
    await h.enter('Corner radius', 8)
    await h.settled()
    await h.enter('Corner radius', 16)
    await h.settled()
    await h.enter('Horizontal padding', 24)
    await h.settled()
    await h.showEdits()
    const row = i => h.host.locator('.li-pending-row').nth(i)
    const state = i => row(i).getAttribute('data-preview-state')
    assert.deepEqual(await Promise.all([state(0), state(1), state(2)]), ['superseded', 'applied', 'applied'])
    const eye = i => row(i).locator('.li-visibility-action')
    const toggle = async i => {
      await eye(i).focus()
      await eye(i).click()
      await h.settled()
    }
    await toggle(0)
    assert.equal(await state(0), 'hidden')
    assert.equal(await state(1), 'applied')
    assert.equal(await h.css('border-radius'), '16px')
    await h.app.locator('#target').evaluate(node => {
      const replacement = node.cloneNode(true)
      replacement.removeAttribute('style')
      node.replaceWith(replacement)
    })
    await h.app.waitForFunction(() => getComputedStyle(document.querySelector('#target')).borderRadius === '16px')
    await toggle(1)
    assert.equal(await h.css('border-radius'), '0px')
    await toggle(0)
    assert.equal(await h.css('border-radius'), '8px')
    await toggle(2)
    assert.equal(await h.css('padding-left'), '16px')
    assert.equal(await h.css('padding-right'), '16px')
    assert.equal(await h.host.locator('#edits-tab').innerText(), 'Edits 3')
    const journal = await h.journal()
    assert.deepEqual(journal.map(edit => Boolean(edit.previewHidden)), [false, true, true, true])
    await h.previewAction('Show original')
    assert.equal(await h.css('border-radius'), '0px')
    await h.previewAction('Show previews')
    await h.settled()
    assert.equal(await h.css('border-radius'), '8px')
    const fresh = await createHarness({ pendingEdits: true, journal })
    try {
      await fresh.open()
      await fresh.showEdits()
      assert.equal(await fresh.css('border-radius'), '8px')
      const hidden = fresh.host.locator('.li-pending-row').nth(2).locator('.li-visibility-action')
      assert.equal(await hidden.getAttribute('aria-pressed'), 'false')
      await hidden.click()
      await fresh.settled()
      assert.equal(await fresh.css('padding-left'), '24px')
      assert.equal(await fresh.css('padding-right'), '24px')
      assert.equal((await fresh.journal()).length, 4)
    } finally { await fresh.close() }
  } finally { await h.close() }
})

test('prepared edits observe rendered output and current source revision at every visible use', async () => {
  const site = 'fixture-radius'
  const revision = 'a'.repeat(64)
  const prepared = { site, revision, file: 'fixture.jsx' }
  const record = (id, value) => ({
    id, prepared, route: '/', property: 'border-radius', before: '0px',
    observed: value, requested: value, restore: 'unique',
    target: { tag: 'div', id: null, key: null, slot: null },
  })
  const h = await createHarness({
    pendingEdits: true,
    journal: [record('older-radius', '12px'), record('newer-radius', '24px')],
    flowPages: {
      '/': { body: `<script>
        const contract = ${JSON.stringify({ site, revision, style: 'border-radius' })};
        window.fixtureRevisions = { [contract.site]: contract.revision };
        window.publishFixtureRevisions = () => document.dispatchEvent(new CustomEvent('li-prepared-revisions',
          { detail: JSON.stringify(window.fixtureRevisions) }));
        document.addEventListener('li-read-prepared-revisions', window.publishFixtureRevisions);
        for (const id of ['first-use', 'second-use']) {
          const element = document.createElement('div');
          element.id = id;
          element.dataset.liRevision = contract.revision;
          element.dataset.liContract = JSON.stringify(contract);
          element.textContent = id;
          element.style.borderRadius = 'var(--li-' + contract.revision.slice(0, 20) + '-border-radius, 0px)';
          document.body.append(element);
        }
      </script>` },
    },
  })
  try {
    await h.open()
    await h.showEdits()
    const rows = h.host.locator('.li-pending-row')
    assert.equal(await rows.first().getAttribute('data-preview-state'), 'superseded')
    assert.equal(await rows.last().getAttribute('data-preview-state'), 'applied')
    assert.equal(await h.css('border-radius', '#first-use'), '24px')
    assert.equal(await h.css('border-radius', '#second-use'), '24px')

    await h.app.locator('#second-use').evaluate(node => node.style.setProperty('border-radius', '2px', 'important'))
    await rows.last().locator('.li-pending-open').click()
    assert.match(await h.host.locator('#pending-status').textContent(), /couldn’t be applied/)
    assert.equal(await h.css('border-radius', '#first-use'), '24px')
    assert.equal(await h.css('border-radius', '#second-use'), '2px')

    await h.app.evaluate(() => {
      document.querySelector('#first-use').hidden = true
      document.querySelector('#second-use').hidden = true
    })
    await h.showEdits()
    assert.equal(await rows.last().getAttribute('data-preview-state'), 'unobservable')
    await rows.last().locator('.li-pending-open').click()
    const notice = h.host.locator('#pending-status')
    assert.match(await notice.textContent(), /unavailable in the current view/)
    assert.equal(await notice.getAttribute('data-error'), null)

    await h.app.evaluate(([name, next]) => {
      window.fixtureRevisions[name] = next
      window.publishFixtureRevisions()
    }, [site, 'b'.repeat(64)])
    await rows.last().locator('.li-pending-open').click()
    assert.match(await h.host.locator('#pending-status').textContent(), /source changed/i)
  } finally { await h.close() }
})

test('Undo after Compare restores the preceding inline height through an app transition', async () => {
  const h = await createHarness({ pendingEdits: true, appStyles: '#target {height:40px; transition:height 160ms ease}' })
  try {
    await h.open()
    await h.select()
    for (const value of [56, 60]) {
      await h.enter('Height', value)
      await h.settled()
      assert.equal(await h.css('height'), value + 'px')
    }
    await h.showEdits()
    const toggle = h.host.locator('#clear')
    const height = value => h.app.waitForFunction(value =>
      getComputedStyle(document.getElementById('target')).height === value, value, { timeout: 2500 })
    await toggle.click()
    await height('40px')
    await toggle.click()
    await h.settled()
    await height('60px')
    await h.host.locator('#undo').click()
    await h.settled()
    assert.deepEqual((await h.journal()).map(e => e.requested), ['56px'])
    await height('56px')
    assert.equal(await h.host.locator('.li-pending-row').getAttribute('data-preview-state'), 'applied')
    await h.app.locator('#target').evaluate(node => { node.style.height = '45px' })
    await height('45px')
    assert.equal(await h.app.locator('#target').evaluate(node => node.style.height), '45px')
  } finally { await h.close() }
})
