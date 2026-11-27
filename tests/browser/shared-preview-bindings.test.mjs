import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHarness } from './harness.mjs'

test('a reviewed occurrence rolls back a failed second property and suspends preview for duplicate mounts', async () => {
  const site = 'mapped-fixture'
  const revision = 'a'.repeat(64)
  const prefix = '--li-' + revision.slice(0,20)
  const contract = {site,revision,file:'src/Card.jsx',mapping:'selected',styles:['border-radius','padding-top']}
  const h = await createHarness({
    authoredUse:true,
    preparedPreviews:true,
    failSave:2,
    flowPages:{
      '/':{body:`<script>
        const contract = ${JSON.stringify(contract)}
        document.addEventListener('li-read-prepared-revisions', () =>
          document.dispatchEvent(new CustomEvent('li-prepared-revisions', {detail:JSON.stringify({[contract.site]:contract.revision})})))
        const card = document.getElementById('target')
        card.dataset.liRevision = contract.revision
        card.dataset.liMappedScope = contract.mapping
        card.dataset.liContract = JSON.stringify(contract)
        card.style.borderRadius = 'var(${prefix}-border-radius, 12px)'
        card.style.padding = 'var(${prefix}-padding-top, 16px) 13px 0 13px'
      </script>`},
    },
  })
  try {
    await h.open()
    await h.select()
    await h.host.locator('#authored-edit-scope').selectOption('selected')
    await h.enter('Corner radius',17)
    await h.settled()
    assert.equal(await h.css('border-radius'),'17px')
    const saved = await h.journal()
    assert.equal(saved.length,1)
    assert.equal(saved[0].prepared.mapping,'selected')

    await h.enter('Top padding',28)
    await h.settled()
    assert.match(await h.host.locator('#status').innerText(),/Simulated save failure/)
    assert.deepEqual(await h.journal(),saved)
    assert.equal(await h.css('border-radius'),'17px')
    for (const [side,value] of [['top','16px'],['right','13px'],['bottom','0px'],['left','13px']])
      assert.equal(await h.css('padding-'+side),value)

    await h.app.locator('#target').evaluate(node => {
      const duplicate = node.cloneNode()
      duplicate.id = 'unexpected-placement'
      node.after(duplicate)
    })
    await h.app.waitForFunction(() =>
      ['target','unexpected-placement'].every(id => getComputedStyle(document.getElementById(id)).borderRadius === '12px'))
    await h.app.locator('#unexpected-placement').evaluate(node => node.remove())
    await h.app.waitForFunction(() => getComputedStyle(document.getElementById('target')).borderRadius === '17px')
    assert.deepEqual(await h.journal(),saved)
  } finally { await h.close() }
})
