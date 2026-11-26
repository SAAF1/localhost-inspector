import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSourceHandoff } from '../source-handoff.mjs'
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

test('completion clears shared-padding peers omitted from the source handoff', () => {
  const padding = ['anchor-top', 'anchor-bottom', 'peer-top', 'peer-bottom'].map(id =>
    edit(id, { group: 'anchor-top', sharedPadding: 'rows', property: 'padding-' + id.split('-').at(-1) }),
  )
  const independent = edit('independent')
  const journal = { edits: [...padding, independent] }

  const result = completeHandoff(binding, journal, report('anchor-top'), completedAt)

  assert.deepEqual(result.retired, padding.map(entry => entry.id))
  assert.deepEqual(journal.edits, [independent])
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

test('completion preserves a text-style definition until its pending applications are complete', () => {
  const name = '--text-heading'
  const definition = edit('create', {
    group: 'create', property: 'font-weight', requested: 'var(--text-heading-font-weight, 600)',
    pendingTextStyle: { name, values: { 'font-weight': '600' } },
  })
  const application = edit('apply', {
    group: 'apply', property: 'font-weight', requested: definition.requested, pendingTextStyleName: name,
  })
  const unrelated = edit('unrelated')
  const journal = { edits: [definition, application, unrelated] }
  const original = structuredClone(journal)

  assert.throws(() => completeHandoff(binding, journal, report('create'), completedAt), /--text-heading/)
  assert.deepEqual(journal, original)

  completeHandoff(binding, journal, report('create', 'apply'), completedAt)
  assert.deepEqual(journal.edits, [unrelated])
  assert.deepEqual(journal.completed.map(edit => edit.id), ['create', 'apply'])
})

test('handoff exports the current prepared basis and completion retires its transition', () => {
  const prepared = { file: 'src/Card.jsx', site: 'card', revision: 'original' }
  const journal = { revision: 4, edits: [edit('spacing', { prepared })], preparedRevisions: { spacing: 'current' } }
  assert.equal(buildSourceHandoff(binding, journal).operations[0].changes[0].prepared.revision, 'current')
  assert.equal(prepared.revision, 'original')
  completeHandoff(binding, journal, report('spacing'), completedAt)
  assert.deepEqual(journal.preparedRevisions, {})
  assert.deepEqual(journal.edits, [])
})
