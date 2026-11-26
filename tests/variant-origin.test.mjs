import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { watchProposalLink } from '../scripts/flow/proposal-link.mjs'

test('a picture-backed step opens one isolated origin on demand while legacy consumers receive ready origins', async t => {
  const root = await mkdtemp(join(tmpdir(), 'inspector-lazy-origins-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const owner = join(root, 'variants', 'flow')
  await mkdir(join(owner, 'preview'), { recursive: true })
  await writeFile(join(owner, 'preview/index.html'), '<p>Saved flow</p>')
  await writeFile(join(root, 'canvas-project.json'), '{"version":1}')
  await writeFile(join(root, 'map.json'), JSON.stringify({ frames: [{ id: 'a', route: '/' }] }))
  const steps = ['one', 'two', 'live'].map(key => ({ key, label: key, route: '/' + key }))
  await writeFile(join(owner, 'frame.json'), JSON.stringify({ id: 'flow', anchor: 'a', section: 'Flow', steps }))
  for (const { key } of steps) await mkdir(join(owner, 'steps', key), { recursive: true })
  const pictures = Object.fromEntries(steps.slice(0, 2).map(({ key, route }) => [
    'flow~' + key, { route, width: 1200, height: 800, small: 'a'.repeat(64), sharp: 'b'.repeat(64) },
  ]))
  await writeFile(join(root, 'variant-previews.json'), JSON.stringify(pictures))
  const reserved = createServer().listen(0, '127.0.0.1')
  await once(reserved, 'listening')
  const port = reserved.address().port
  await new Promise(done => reserved.close(done))
  const host = spawn(process.execPath, ['scripts/flow/serve.mjs', join(owner, 'preview'), String(port), root])
  t.after(async () => {
    if (host.exitCode !== null || host.signalCode !== null) return
    const exit = once(host, 'exit')
    host.kill()
    await exit
  })
  await Promise.race([once(host.stdout, 'data'), once(host, 'exit').then(() => { throw Error('Canvas host exited') })])
  const origin = 'http://127.0.0.1:' + port
  const url = origin + '/__inspector-flow/'
  const lazy = { headers: { 'X-Inspector-Preview-Origins': 'on-demand' } }
  const load = (resource, options) => fetch(url + resource, options).then(response => response.json())
  const map = await load('map.json', lazy)
  assert.equal(map.previewOrigins, 'on-demand')
  assert.ok(map.previewOriginSession)
  assert.equal(map.variants[0].deferredOrigin, true)
  assert.equal(map.variants[0].origin, undefined)
  assert.ok(map.variants[2].origin, 'an uncaptured row is live-only')

  async function publishedOrigins(query) {
    const response = await fetch(url + 'proposal-events' + query, { signal: AbortSignal.timeout(5000) })
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let text = ''
    try {
      while (!text.includes('event: activity')) {
        const chunk = await reader.read()
        assert.equal(chunk.done, false)
        text += decoder.decode(chunk.value, { stream: true })
      }
      return JSON.parse(text.match(/event: preview-origins\ndata: ([^\n]+)/)[1])
    } finally {
      await reader.cancel()
    }
  }
  const query = '?previewOrigins=on-demand'
  async function openCatalog(knownVersion, lastEventId) {
    const headers = lastEventId ? { 'Last-Event-ID': lastEventId } : {}
    const response = await fetch(url + 'proposal-events' + query + '&knownVersion=' + knownVersion, {
      headers, signal: AbortSignal.timeout(5000),
    })
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let pending = ''
    return {
      close: () => reader.cancel(),
      async next() {
        for (;;) {
          if (!pending.includes('\n\n')) {
            const chunk = await reader.read()
            assert.equal(chunk.done, false)
            pending += decoder.decode(chunk.value, { stream: true })
            continue
          }
          const end = pending.indexOf('\n\n')
          const block = pending.slice(0, end)
          pending = pending.slice(end + 2)
          const event = block.match(/^event: (catalog(?:-current)?)$/m)?.[1]
          if (event) return {
            event, id: block.match(/^id: (.+)$/m)[1], payload: JSON.parse(block.match(/^data: (.+)$/m)[1]),
          }
        }
      },
    }
  }
  assert.match(map.activityVersion, /^[a-f0-9]{64}$/)
  const connected = await openCatalog(map.activityVersion)
  let changed
  const unpublished = join(root, 'unpublished-flow')
  try {
    assert.deepEqual(await connected.next(), { event: 'catalog-current', id: map.activityVersion, payload: {} })
    // Change the watched variants directory atomically, as publishing a flow does.
    await rename(owner, unpublished)
    changed = await connected.next()
    assert.equal(changed.event, 'catalog')
    assert.notEqual(changed.id, map.activityVersion)
    assert.equal(changed.payload.session, map.previewOriginSession)
    assert.deepEqual(changed.payload.variants, [])
    assert.deepEqual(changed.payload.activity, [])
  } finally {
    await connected.close()
  }
  // The original URL still carries version A, but the browser already received B.
  // An offline revert back to A must be delivered, not mistaken for a match.
  await rename(unpublished, owner)
  const reconnected = await openCatalog(map.activityVersion, changed.id)
  try {
    const restored = await reconnected.next()
    assert.equal(restored.event, 'catalog')
    assert.equal(restored.id, map.activityVersion)
    assert.equal(restored.payload.variants[0].section, 'Flow')
  } finally {
    await reconnected.close()
  }
  const sse = await publishedOrigins(query)
  assert.equal(sse.session, map.previewOriginSession)
  assert.equal(sse.variants[0].deferredOrigin, true)
  const resolver = 'preview-origin?id='
  const headers = { origin }
  assert.equal((await fetch(url + resolver + 'flow~one', { headers: { origin: 'https://example.invalid' } })).status, 403)
  assert.equal((await fetch(url + resolver + 'flow~missing', { headers })).status, 404)
  assert.equal((await fetch(url + resolver + 'flow', { headers })).status, 404)
  const resolveOne = () => load(resolver + 'flow~one', { headers })
  const [first, again] = await Promise.all([resolveOne(), resolveOne()])
  assert.deepEqual(first, again)
  assert.equal(first.id, 'flow~one')
  assert.equal(new URL(first.origin).hostname, '127.0.0.1')
  const check = await fetch(first.origin + '/__inspector-flow/variant-inspector', {
    method: 'POST', headers: { origin: first.origin, 'content-type': 'application/json' }, body: JSON.stringify({ type: 'check' }),
  }).then(response => response.json())
  assert.equal(check.value.id, first.id)
  const after = await load('map.json' + query)
  assert.equal(after.variants[0].origin, first.origin)
  assert.equal(after.variants[1].deferredOrigin, true)
  assert.equal(after.variants[1].origin, undefined)
  const legacy = await publishedOrigins('')
  assert.ok(Array.isArray(legacy))
  assert.equal(legacy[0].origin, first.origin)
  assert.notEqual(legacy[1].origin, first.origin)
  assert.equal((await load('map.json')).previewOrigins, undefined)

  // Grow the same catalog, then read the plain endpoint before opening a
  // new preview. Only the three previously used origins should already exist.
  const more = Array.from({ length: 100 }, (_, i) => ({ key: 'saved-' + i, label: 'Saved ' + i, route: '/saved' }))
  for (const step of more) pictures['flow~' + step.key] = { ...pictures['flow~one'], route: step.route }
  await writeFile(join(root, 'variant-previews.json'), JSON.stringify(pictures))
  await writeFile(join(owner, 'frame.json'), JSON.stringify({ id: 'flow', anchor: 'a', section: 'Flow', steps: steps.concat(more) }))
  const large = await load('map.json')
  assert.equal(large.previewOrigins, 'on-demand')
  assert.equal(large.variants.filter(step => step.origin).length, 3)
  assert.equal(large.variants.filter(step => step.deferredOrigin).length, 100)
  assert.match(large.activityVersion, /^[a-f0-9]{64}$/)
  const largeStream = await publishedOrigins('')
  assert.equal(largeStream.session, large.previewOriginSession)
  assert.equal(largeStream.variants.filter(step => step.deferredOrigin).length, 100)
  const selected = await load(resolver + 'flow~saved-50', { headers })
  assert.equal(selected.id, 'flow~saved-50')
  assert.equal((await load('map.json')).variants.filter(step => step.origin).length, 4)
})

test('a restored page reconnects using its last applied catalog version', t => {
  const originalWindow = globalThis.window
  const originalSource = globalThis.EventSource
  const instances = []
  globalThis.window = new EventTarget()
  globalThis.EventSource = class extends EventTarget {
    constructor(url) { super(); this.url = url; instances.push(this) }
    close() { this.closed = true }
  }
  t.after(() => {
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
    if (originalSource === undefined) delete globalThis.EventSource
    else globalThis.EventSource = originalSource
  })
  const updates = []
  watchProposalLink(() => {}, data => updates.push(data.session), data => updates.push(data.activity), true, 'first')
  assert.match(instances[0].url, /knownVersion=first$/)
  const data = JSON.stringify({ session: 'active', variants: [], activity: [] })
  instances[0].dispatchEvent(new MessageEvent('catalog', { data, lastEventId: 'second' }))
  assert.deepEqual(updates, ['active', []])
  window.dispatchEvent(new Event('pagehide'))
  assert.equal(instances[0].closed, true)
  window.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }))
  assert.match(instances[1].url, /knownVersion=second$/)
})
