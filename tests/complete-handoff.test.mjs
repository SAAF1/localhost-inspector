import assert from 'node:assert/strict'
import test from 'node:test'
import { completeHandoff } from '../complete-handoff.mjs'

const binding = { id: 'bound-project' }
const completedAt = '2026-11-16T18:30:00.000Z'
const edit = (id, fields = {}) => ({
  id, route: '/tasks', target: { tag: 'div' }, property: 'gap', requested: '12px',
  intent: 'feature-template', ...fields,
})
const summary = 'Verified the shared template and its neighbors with previews off.'
const report = (...ids) => ({ projectId: binding.id, verified: ids.map(id => ({ id, summary })) })

test('completing verified operations retires all grouped members and leaves other operations intact', () => {
  const earlier = { id: 'earlier', summary, completedAt }
  const untouched = edit('untouched')
  const journal = { edits: [edit('first', { group: 'first' }), edit('second', { group: 'first' }), untouched],
    completed: [earlier] }
  const expected = { id: 'first', summary, completedAt }

  assert.deepEqual(completeHandoff(binding, journal, report('first'), completedAt), {
    completed: [expected], retired: ['first', 'second'],
  })
  assert.deepEqual(journal.edits, [untouched])
  assert.deepEqual(journal.completed, [earlier, expected])
})

test('a mixed invalid completion request leaves every edit and prior result intact', () => {
  const journal = { edits: [edit('first'), edit('legacy', { intent: undefined }), edit('button', { property: 'button-size' })] }
  const original = structuredClone(journal)
  for (const request of [
    report('first', 'missing'),
    report('first', 'first'),
    report('first', 'legacy'),
    report('first', 'button'),
    report(),
    { ...report('first'), projectId: 'unbound-project' },
    { ...report('first'), verified: [{ id: 'first', summary: ' ' }] },
  ]) {
    assert.throws(() => completeHandoff(binding, journal, request, completedAt))
    assert.deepEqual(journal, original)
  }
})
