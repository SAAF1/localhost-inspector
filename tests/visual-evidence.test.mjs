import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { addVisualEvidence, removeVisualEvidence, saveVisualEvidence } from '../visual-evidence.mjs'

const id = '56dba965-08fe-4b5c-8cc0-82af5a85b697'
const binding = { id: '270ffe32-5d18-479b-95aa-59c27d6f8322', visualEvidence: true }
const journal = { edits: [{ id, route: '/tasks', intent: 'feature-template', property: 'gap' }] }
const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jYiwAAAAASUVORK5CYII='

test('visual evidence applies only to an enabled, active edit in the bound project', async t => {
  const root = await mkdtemp(join(tmpdir(), 'inspector-evidence-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  assert.equal(await saveVisualEvidence(root, { ...binding, visualEvidence: false }, journal, id, '/tasks', image), false)
  assert.equal(await saveVisualEvidence(root, binding, journal, id, '/elsewhere', image), false)
  assert.equal(await saveVisualEvidence(root, binding, journal, id, '/tasks', 'malformed'), false)
  assert.equal(await saveVisualEvidence(root, binding, journal, '../../other', '/tasks', image), false)
  assert.equal(await saveVisualEvidence(root, binding, journal, id, '/tasks', image), true)

  const current = { id, status: 'pending' }
  const other = { id: 'e01bbf42-0977-4954-b118-98ecf58fb272', status: 'pending' }
  const blocked = { id, status: 'blocked' }
  await addVisualEvidence(root, binding, { operations: [current, other, blocked] })
  assert.deepEqual(await readFile(current.visualEvidence.imagePath), Buffer.from(image, 'base64'))
  assert.equal(other.visualEvidence, undefined)
  assert.equal(blocked.visualEvidence, undefined)

  const pending = { id, status: 'pending' }
  await addVisualEvidence(root, { ...binding, visualEvidence: false }, { operations: [pending] })
  assert.equal(pending.visualEvidence, undefined)
  await removeVisualEvidence(root, binding, [id])
  await addVisualEvidence(root, binding, { operations: [pending] })
  assert.equal(pending.visualEvidence, undefined)
})
