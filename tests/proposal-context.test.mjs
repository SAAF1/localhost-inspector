import assert from 'node:assert/strict'
import test from 'node:test'
import { proposalContext, reviewUrl } from '../scripts/proposal-context.mjs'

const original = 'http://127.0.0.1:5100'
const candidate = 'http://127.0.0.1:5101'
const list = { id: 'first', route: '/records', steps: [], checkpoint: [] }
const dialog = { ...list, id: 'second', steps: [{ role: 'button', name: 'Details' }] }
const map = { origin: original, frames: [list, dialog] }

test('cold reopen resolves the saved scenario after frame IDs change and retains the filter', () => {
  const context = proposalContext(map, original + '/__inspector-flow/#context=1&frame=second&page=%2Frecords%3Fq%3Dgreen')
  const refreshed = { ...map, frames: [list, { ...dialog, id: 'third' }] }
  const restored = proposalContext(refreshed, null, context)
  const address = new URL(reviewUrl(candidate, restored))
  assert.equal(address.search, '')
  const state = new URLSearchParams(address.hash.slice(1))
  assert.equal(state.get('page'), '/records?q=green')
  assert.equal(state.get('frame'), 'third')
  assert.throws(() => proposalContext({ ...map, frames: [list] }, null, context), /saved scenario changed/)
})

test('a conflicting frame ID, ambiguous page or another origin cannot silently choose a scenario', () => {
  assert.throws(() => proposalContext(map, original + '/__inspector-flow/?frame=first&page=%2Fother'))
  assert.throws(() => proposalContext({ ...map, frames: [list, { ...list, id: 'duplicate' }] }, '/records?q=a'))
  assert.throws(() => proposalContext(map, candidate + '/records'))
})

test('a workspace live-route receipt stays local and cannot reopen an Inspector endpoint', async () => {
  const { lastAppRoute } = await import('../scripts/flow/proposal-view.mjs')
  for (const invalid of [null, {}, '//elsewhere.example/page', '/\\elsewhere.example/page', '/a/../__inspector-flow/']) {
    assert.equal(lastAppRoute({ inspectorAppRoute: invalid }, original), null)
  }
  assert.equal(lastAppRoute({ inspectorAppRoute: '/browse?query=a#/page' }, original), '/browse?query=a#/page')
})
