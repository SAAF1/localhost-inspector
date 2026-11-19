import assert from 'node:assert/strict'
import test from 'node:test'
import { removePendingEdit } from '../journal-edits.mjs'

const change = (id, before, requested, target) => ({
  id, route: '/orders', property: 'gap', before, requested, observed: requested, target, restore: 'unique',
})

test('identical values on separately identified elements do not form a removal chain', () => {
  const first = change('first', '8px', '12px', { tag: 'div', key: 'delivery-row' })
  const other = change('other', '12px', '16px', { tag: 'div', key: 'billing-row' })
  assert.deepEqual(removePendingEdit([first, other], 'first'), { edits: [other], removed: [first], rebased: [] })
})

test('ambiguous or nonliteral scope preserves the journal instead of rebasing a possible dependency', () => {
  const unknown = { tag: 'div', id: null, slot: 'row' }
  const first = change('first', '8px', '12px', unknown)
  const later = change('later', '12px', '16px', unknown)
  const edits = [first, later]
  assert.throws(() => removePendingEdit(edits, 'first'), /can’t tell whether a newer edit uses this value/)
  assert.deepEqual(edits.map(edit => edit.before), ['8px', '12px'])

  const known = { tag: 'div', key: 'delivery-row' }
  const literal = change('literal', '8px', '12px', known)
  const named = { ...change('named', '12px', '16px', known), spacingToken: { name: '--gap' } }
  assert.throws(() => removePendingEdit([literal, named], 'literal'), /A newer edit on this element may use this value/)
})

test('an equal-value edit on an unidentified target can be removed from the saved list', () => {
  const target = { tag: 'span', id: null, slot: null }
  const first = { ...change('token', '8px', '8px', target), restore: 'ambiguous', spacingToken: { name: '--space-2' } }
  const later = { ...change('later', '8px', '12px', target), restore: 'ambiguous' }
  assert.deepEqual(removePendingEdit([first, later], 'token'),
    { edits: [later], removed: [first], rebased: [] })
})

test('an unrelated baseline on a lookalike does not block removal', () => {
  const target = { tag: 'span', id: null, slot: null }
  const first = change('first', '8px', '12px', target)
  const later = change('later', '4px', '16px', target)
  assert.deepEqual(removePendingEdit([first, later], 'first'),
    { edits: [later], removed: [first], rebased: [] })
})
