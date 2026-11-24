import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { handleVariantInspector, variantJournal } from '../scripts/flow/variant-journal.mjs'

const execute = promisify(execFile)

test('concurrent variant changes conflict, survive archive transfer, and revert independently', async () => {
  const root = await mkdtemp(join(tmpdir(), 'portable-variant-edits-'))
  const canvas = join(root, 'canvas')
  const original = join(root, 'built')
  const load = { type: 'load', route: '/reports?status=open' }
  const target = { id: 'title', tag: 'h1', slot: null, key: null }
  const edit = size => ({ type: 'save', expectedRevision: 0, record: {
    id: randomUUID(), route: load.route, target, property: 'font-size', requested: size, observed: size, before: '18px', restore: 'unique',
  } })
  try {
    await mkdir(original)
    await writeFile(join(original, 'index.html'), '<h1 id="title">Report</h1>')
    await mkdir(canvas)
    await writeFile(join(canvas, 'canvas-project.json'), '{"version":1}')
    await writeFile(join(canvas, 'map.json'), JSON.stringify({ origin: 'http://127.0.0.1:5050', frames: [{ id: 'a', route: '/' }] }))
    for (const id of ['a', 'b']) {
      const frame = join(canvas, 'variants', id)
      await mkdir(join(frame, 'preview'), { recursive: true })
      await writeFile(join(frame, 'frame.json'), JSON.stringify({ id, anchor: 'a', label: id, route: '/' }))
      await writeFile(join(frame, 'preview/index.html'), '<h1>Report</h1>')
    }
    const open = (dir, id) => variantJournal(join(dir, 'variants', id), id)
    const results = await Promise.allSettled([open(canvas, 'a').handle(edit('20px')), open(canvas, 'a').handle(edit('24px'))])
    assert.deepEqual(results.map(entry => entry.status).sort(), ['fulfilled', 'rejected'])
    assert.equal(results.find(entry => entry.status === 'rejected').reason.code, 'STALE_JOURNAL')
    const owner = open(canvas, 'a')
    const saved = await owner.handle(load)
    assert.equal(saved.edits.length, 1)
    assert.equal(saved.revision, 1)
    assert.equal((await owner.handle({ ...load, route: '/reports?status=closed' })).edits.length, 0)
    assert.equal((await open(canvas, 'b').handle(load)).revision, 0)
    const archive = join(root, 'canvas.zip')
    const imported = join(root, 'imported')
    const cli = (...args) => execute(process.execPath, ['scripts/flow/canvas.mjs', ...args])
    await cli('export', canvas, archive, original)
    await cli('import', archive, imported)
    const copy = open(imported, 'a')
    assert.deepEqual(await copy.handle(load), saved)
    await copy.handle({ type: 'resetAll', expectedRevision: 1 })
    assert.equal(await copy.hasEdits(), false)
    assert.equal((await copy.handle(load)).revision, 2)
    assert.equal(await owner.hasEdits(), true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('a different preview, opaque origin or ordinary HTML form cannot write a variant journal', async () => {
  const address = new URL('http://127.0.0.1:5401')
  const forbidden = { handle() { assert.fail('Unexpected journal access') } }
  for (const [method, origin, contentType] of [
    ['POST', 'http://127.0.0.1:5402', 'application/json'],
    ['POST', 'null', 'application/json'],
    ['POST', address.origin, 'text/plain'],
    ['GET', address.origin, 'application/json'],
  ]) {
    const response = { writeHead(code) { assert.equal(code, 403) }, end(body) { assert.equal(JSON.parse(body).ok, false) } }
    await handleVariantInspector({ method, headers: { origin, 'content-type': contentType } }, response, address, forbidden)
  }
})
