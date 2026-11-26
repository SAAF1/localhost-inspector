import assert from 'node:assert/strict'
import test from 'node:test'
import { cssFields } from '../scripts/flow/prepared-css.mjs'

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
