import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { checkRefresh } from '../scripts/preview-session.mjs'

test('refresh checks the retained journal even after its preview server stops', t => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'inspector-refresh-')))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const source = join(dir, 'app')
  const state = join(dir, 'state')
  mkdirSync(source)
  mkdirSync(state)
  const port = '56213'
  const origin = 'http://127.0.0.1:' + port
  const binding = { id: 'old-preview', origin, source }
  const context = { scenario: 'recorded', frame: 'orders', page: '/orders' }
  const save = (file, value) => writeFileSync(file, JSON.stringify(value))
  save(join(dir, 'preview-session.json'), { state, binding: binding.id, port, context })
  save(join(state, 'bindings.json'), { [origin]: binding })
  const journal = { binding, version: 2, revision: 1, edits: [] }
  const file = join(state, binding.id + '-changes.json')
  save(file, { ...journal, textStyleDefinitions: [{ name: '--order-label', source: 'theme.css' }] })
  assert.throws(() => checkRefresh(dir), /pending/)
  save(file, { ...journal, edits: [{ id: 'gap', property: 'gap', requested: '17px', target: { tag: 'div' } }] })
  assert.throws(() => checkRefresh(dir), /pending/)
  save(file, journal)
  assert.deepEqual(checkRefresh(dir), context)
  save(join(state, 'bindings.json'), { [origin]: { ...binding, id: 'other-preview' } })
  assert.throws(() => checkRefresh(dir), /different proposal/)
})
