import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSourceHandoff, featureTemplateScope, sourceContextFrom } from '../source-handoff.mjs'

const binding = { id: 'fixture', origin: 'http://127.0.0.1:5173', source: '/example/worktree' }
const edit = (id, fields = {}) => ({
  id, intent: featureTemplateScope, route: '/tasks', target: { tag: 'div', slot: null }, restore: 'ambiguous',
  property: 'gap', requested: '12px', before: '8px', observed: '12px', ...fields,
})

test('handoff carries exact gap intent, visual evidence and grouping independently from preview recovery', () => {
  const target = { tag: 'div', slot: null, text: 'private page content', textFingerprint: 'preview guard', classFingerprint: 'a'.repeat(64) }
  const sourceContext = {
    ancestors: [{ tag: 'td', slot: 'table-cell', text: 'private row' }, { tag: 'tr', role: 'row', id: 'row-id' }],
    childTags: ['svg', 'span'], tableCellPosition: 4, tableRowCellCount: 6, bounds: [31, 84, 120, 24], rowIndex: 3,
  }
  const token = { source: 'theme.css', name: '--foreground' }
  const journal = { revision: 9, edits: [
    edit('gap', { target, sourceContext }),
    edit('font', { group: 'font', property: 'font-size', requested: '18px' }),
    edit('tracking', { group: 'font', property: 'letter-spacing', requested: '0.1px' }),
    edit('color', { property: 'color', requested: 'var(--foreground)', colorToken: token }),
    edit('undone', { undone: true }),
  ] }
  const handoff = buildSourceHandoff(binding, journal)
  assert.deepEqual(handoff.project, binding)
  assert.equal(handoff.revision, 9)
  assert.deepEqual(handoff.operations.map(operation => operation.id), ['gap', 'font', 'color'])
  const [gap, font, color] = handoff.operations
  assert.equal(gap.scope, featureTemplateScope)
  assert.equal(gap.sourceOwner, 'unresolved')
  assert.equal(gap.status, 'pending')
  const [change] = gap.changes
  assert.equal(change.previewRestore, 'ambiguous')
  assert.equal(change.property, 'gap')
  assert.equal(change.target.classFingerprint, target.classFingerprint)
  assert.deepEqual(change.affectedProperties, ['row-gap', 'column-gap'])
  assert.equal(change.requested, '12px')
  assert.deepEqual(change.sourceContext, {
    ancestors: [{ tag: 'td', slot: 'table-cell' }, { tag: 'tr', slot: undefined, role: 'row' }],
    childTags: ['svg', 'span'], tableCellPosition: 4, tableRowCellCount: 6, bounds: [31, 84, 120, 24],
  })
  assert.deepEqual(font.changes.map(({ id, property }) => [id, property]),
    [['font', 'font-size'], ['tracking', 'letter-spacing']])
  assert.deepEqual(color.changes[0].colorToken, token)
  assert.doesNotMatch(JSON.stringify(handoff), /private page content|private row|preview guard|row-id|rowIndex/)
})

test('legacy and opt-in Button proof remain blocked while divergent same-route operations stay ordered', () => {
  const handoff = buildSourceHandoff(binding, { revision: 7, edits: [
    edit('legacy', { intent: 'selected occurrence only' }),
    edit('one'),
    edit('button', { property: 'button-size' }),
    edit('two', { requested: '18px' }),
    edit('other-route', { route: '/dashboard', requested: '16px' }),
  ] })
  const [legacy, one, button, two, otherRoute] = handoff.operations
  assert.equal(legacy.status, 'blocked')
  assert.equal(legacy.reason, 'legacy-scope-not-recorded')
  assert.equal(button.status, 'blocked')
  assert.equal(button.reason, 'instance-proof-outside-template-handoff')
  assert.deepEqual([one, two, otherRoute].map(operation => operation.status), ['pending', 'pending', 'pending'])
  assert.deepEqual(handoff.potentialOverlaps, [
    { route: '/tasks', property: 'row-gap', operationIds: ['one', 'two'] },
    { route: '/tasks', property: 'column-gap', operationIds: ['one', 'two'] },
  ])
})

test('malformed and excessive browser metadata cannot expand source context', () => {
  assert.equal(sourceContextFrom({ ancestors: Array(7).fill({ tag: 'td' }) }), undefined)
  assert.equal(sourceContextFrom({ ancestors: [{ tag: 'some page content' }] }), undefined)
  assert.deepEqual(sourceContextFrom({ ancestors: [{ tag: 'td', slot: 'unlikely page text', role: 'private-role' }], tableCellPosition: 4, tableRowCellCount: 3 }), {
    ancestors: [{ tag: 'td', slot: undefined }], childTags: undefined,
  })
  assert.equal(sourceContextFrom({ ancestors: [], tableCellPosition: 4 }).tableCellPosition, undefined)
  assert.equal(sourceContextFrom({ ancestors: [], bounds: ['x', 0, 100, 200] }).bounds, undefined)
})
