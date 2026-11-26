import assert from 'node:assert/strict'
import test from 'node:test'
import { cssFields, panelCssFields } from '../scripts/flow/prepared-css.mjs'

test('ordinary logical padding passes through discovery without a physical edit recipe', () => {
  const declarations = [
    Object.freeze({ prop: 'padding-inline', value: '1rem' }),
    Object.freeze({ prop: 'padding-inline', value: '0.5rem 1.5rem' }),
    Object.freeze({ prop: 'padding-inline', value: 'var(--space-4)' }),
  ]
  for (const declaration of declarations) assert.deepEqual(cssFields(declaration), [])
  assert.deepEqual(cssFields({ prop: 'padding', value: '1rem 2rem' }),
    ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'])
  assert.deepEqual(cssFields({ prop: 'padding-left', value: '8px' }), ['padding-left'])
})

test('literal paint preserves prepared part identity without admitting opaque styles', async () => {
  const { parseAuthoredJsx } = await import('../scripts/flow/authored-forwarding.mjs')
  const { panelOpening, preparedOpenings, preparedStyleTargets } = await import('../scripts/flow/prepared-site-qualification.mjs')
  const site = { styles: [{ local: 'ordinary', property: 'height' }] }
  for (const [style, compatible] of [['', true], [' style={{ color: "#AB6E2F" }}', true],
    [' style={props.style}', false], [' style={{ color: shade }}', false],
    [' style={{ color: "#AB6E2F", height: 24 }}', false]]) {
    const code = 'function Title(){return <p' + style + '>Example</p>}'
    const [{ node }] = preparedOpenings(parseAuthoredJsx(code))
    assert.equal(panelOpening(code, node) === '<p>', compatible)
    assert.equal(Boolean(preparedStyleTargets(site, node, code)), compatible)
  }
})


test('panel declarations preserve a typed input and exclude a mismatched property or unqualified shorthand', () => {
  for (const [prop,value] of [
    ['align-items','center'],['font-weight','700'],['line-height','1.5'],['letter-spacing','-0.2px'],
    ['border-color','var(--edge)'],['border-width','0.125rem'],['max-width','60rem'],
  ]) assert.deepEqual(panelCssFields({prop,value}),[prop])
  for(const [prop,value] of [['justify-content','12px'],['padding-inline','2rem 3rem'],['border','1px solid red']])
    assert.deepEqual(panelCssFields({prop,value}),[])
})
