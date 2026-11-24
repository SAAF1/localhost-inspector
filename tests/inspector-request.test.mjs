import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareWorkspaceInspector } from '../scripts/flow/inspector-request.mjs'

test('workspace startup reads use the committed route and only apply on its first load', async t => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (_endpoint, { body }) => {
    const message = JSON.parse(body)
    requests.push(message)
    return Response.json({ ok: true, value: message })
  })
  const startup = prepareWorkspaceInspector()
  assert.equal(requests.some(({ type }) => type === 'load'), false)
  const catalog = { type: 'colorCatalog' }
  assert.deepEqual((await startup.take(catalog)).value, catalog)
  assert.equal(startup.take(catalog), undefined)

  const route = '/app?q=1#!/projects'
  startup.loadRoute(new URL(route, 'http://localhost'))
  assert.deepEqual(requests.at(-1), { type: 'load', route })
  assert.equal(startup.take({ type: 'load', route: '/redirected' }), undefined)
  assert.equal(startup.take({ type: 'load', route }), undefined)

  const fresh = prepareWorkspaceInspector()
  fresh.loadRoute(new URL('/next#heading', 'http://localhost'))
  const load = { type: 'load', route: '/next' }
  assert.deepEqual((await fresh.take(load)).value, load)
  assert.equal(fresh.take(load), undefined)
})

test('switching frames waits for a save already submitted by the outgoing editor', async t => {
  let releaseSave
  let revision = 0
  t.mock.method(globalThis, 'fetch', async (_endpoint, { body }) => {
    const { type } = JSON.parse(body)
    if (type === 'save') {
      await new Promise(resolve => { releaseSave = resolve })
      revision++
    }
    return Response.json({ ok: true, value: revision })
  })
  const outgoing = prepareWorkspaceInspector()
  const write = outgoing.write({ type: 'save', expectedRevision: 0 })
  const incoming = prepareWorkspaceInspector()
  incoming.loadRoute(new URL('/app', 'http://localhost'))
  const read = incoming.take({ type: 'load', route: '/app' })
  releaseSave()
  await write
  assert.equal((await read).value, 1)
})

test('a superseded navigation aborts and discards its catalog reads', t => {
  const signals = []
  t.mock.method(globalThis, 'fetch', async (_endpoint, { signal }) => {
    signals.push(signal)
    return Response.json({ ok: true, value: null })
  })
  const startup = prepareWorkspaceInspector()
  startup.cancel()
  assert.equal(signals.length, 4)
  assert.ok(signals.every(signal => signal.aborted))
  assert.equal(startup.take({ type: 'colorCatalog' }), undefined)
})
