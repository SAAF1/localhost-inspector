import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import MagicString from 'magic-string'
import { parseAuthoredJsx } from '../scripts/flow/authored-forwarding.mjs'
import { markRecordCallers, verifyRecordSource } from '../scripts/flow/record-scope.mjs'
import { planRecordRadius } from '../scripts/flow/record-radius.mjs'
import { buildSourceHandoff } from '../source-handoff.mjs'

const caller =
  'import { Tile } from "./Tile"; export function Shelf({ results, favorites }) { return results.map(row => <Tile key={row.slug} item={row} liked={favorites.includes(row.slug)} />) }'
const owner =
  'export function Tile({item,liked}) { return <article className="tile"><b>{item.name}</b></article> }'

test('selected record retains its render site, record expression and ordinary source boundary', async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'record-use-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  writeFileSync(join(root, 'Tile.jsx'), owner)
  async function instrument(source) {
    writeFileSync(join(root, 'Shelf.jsx'), source)
    const out = new MagicString(source)
    const marked = await markRecordCallers({
      root,
      file: 'Shelf.jsx',
      code: source,
      tree: parseAuthoredJsx(source),
      out,
      resolveImport: () => join(root, 'Tile.jsx'),
    })
    return marked && out.toString()
  }
  const transformed = await instrument(caller)
  parseAuthoredJsx(transformed)
  const descriptor = JSON.parse(transformed.match(/results\.map\(__liRecordIdentity\((\{[^}]*\})/)[1])
  const value = 'tile-307'
  const proof = { ...descriptor, value, key: 'record:' + descriptor.id + ':' + value }
  const change = {
    id: 'example',
    recordScope: proof,
    property: 'border-radius',
    requested: '17px',
    route: '/',
    target: { tag: 'article', key: proof.key },
    intent: 'selected occurrence only',
  }
  const retained = planRecordRadius(root, change)
  assert.match(retained.get('Shelf.jsx').updated, /row\.slug === "tile-307"/)
  assert.match(retained.get('Tile.jsx').updated, /borderRadius: recordCornerRadius/)
  for (const source of retained.values()) parseAuthoredJsx(source.updated)
  const [operation] = buildSourceHandoff({ id: 'x' }, { edits: [change] }).operations
  assert.equal(operation.scope, 'selected-record')
  assert.equal(operation.changes[0].recordScope.field, 'slug')
  // Re-onboard the ordinary accepted files. The renderer prop can have an
  // application-chosen name; the input is identified from the root declaration.
  const acceptedOwner = retained.get('Tile.jsx').updated.replaceAll('recordCornerRadius', 'tileRadius')
  const acceptedCaller = retained.get('Shelf.jsx').updated.replaceAll('recordCornerRadius', 'tileRadius')
  writeFileSync(join(root, 'Tile.jsx'), acceptedOwner)
  const nextTransform = await instrument(acceptedCaller)
  const next = JSON.parse(nextTransform.match(/results\.map\(__liRecordIdentity\((\{[^}]*\})/)[1])
  const current = { ...next, value, key: 'record:' + next.id + ':' + value }
  assert.notEqual(next.id, proof.id)
  const again = planRecordRadius(root, { ...change, recordScope: current, requested: '23px' })
  assert.deepEqual([...again.keys()], ['Shelf.jsx'])
  assert.equal(again.get('Shelf.jsx').updated, acceptedCaller.replace('"17px"', '"23px"'))
  const other = { ...current, value: 'different', key: 'record:' + next.id + ':different' }
  const third = planRecordRadius(root, { ...change, recordScope: other, requested: '9px' })
  assert.match(third.get('Shelf.jsx').updated, /17px.*different.*9px/)
  assert.equal(await instrument(acceptedCaller.replace('=== 1', '>= 1')), false)
  writeFileSync(join(root, 'Tile.jsx'), owner)
  assert.equal(await instrument(caller.replace('favorites.includes(row.slug)', 'false')), false)
  assert.throws(() => verifyRecordSource(root, proof))
  assert.equal(
    await instrument(caller.replace('row =>', '(row, index) =>').replace('key={row.slug}', 'key={index}')),
    false,
  )
  assert.equal(await instrument(caller.replace('item={row}', 'item={{...row}}')), false)
  assert.equal(
    await instrument(
      caller
        .replace('return results.map', 'return [results.map')
        .replace(
          ' />) }',
          ' />), results.map(row => <Tile key={row.slug} item={row} liked={favorites.includes(row.slug)} />)] }',
        ),
    ),
    false,
  )
})

test('record markers survive reordering and reject duplicated or missing identities', async () => {
  const previous = globalThis.document
  globalThis.document = new EventTarget()
  try {
    const { recordIdentity, recordAttributes } = await import('../integrations/prepared-registry.mjs')
    const proof = { id: 'a'.repeat(24), file: 'Tile.jsx', owner: 'Tile' }
    const ids = (rows) =>
      rows.map(
        recordIdentity(
          proof,
          rows,
          'slug',
          (identity) => (row) => recordAttributes(identity(row), 'Tile.jsx', 'Tile')['data-inspector-target'],
        ),
      )
    const first = { slug: 'one' },
      second = { slug: 'two' }
    const [a, b] = ids([first, second])
    assert.deepEqual(ids([second, first]), [b, a])
    assert.deepEqual(ids([first, second, { slug: 'one' }, {}]), [undefined, b, undefined, undefined])
    assert.equal(
      recordAttributes({ ...proof, key: a }, 'Different.jsx', 'Tile')['data-inspector-target'],
      undefined,
    )
  } finally {
    globalThis.document = previous
  }
})

test('a filtered keyed render traces its local equality lookup and the record passed to a React memo root', async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'record-filter-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const renderer = `import {memo as stable} from 'react';
    export const Tile=stable(({item,active})=>{
      const {label}=item;
      return <section><b>{label || 'Unknown'}</b></section>
    })`
  writeFileSync(join(root, 'Tile.jsx'), renderer)
  const caller = `import {useCallback as capture} from 'react'; import {Tile} from './Tile';
    export function Gallery({items}) {
      const {visible}=useProjection(items)
      const chosen=capture((needle)=>entries.find(entry => needle === entry.slug), [entries])
      return visible.map(entry=>{const hit=chosen(entry.slug);return <Tile key={entry.slug} item={entry} active={!!hit}/>})
    }`
  async function trace(source) {
    writeFileSync(join(root, 'Gallery.jsx'), source)
    const out = new MagicString(source)
    if (
      !(await markRecordCallers({
        root,
        file: 'Gallery.jsx',
        code: source,
        tree: parseAuthoredJsx(source),
        out,
        resolveImport: () => join(root, 'Tile.jsx'),
      }))
    )
      return
    const s = out.toString()
    parseAuthoredJsx(s)
    return JSON.parse(s.match(/visible\.map\(__liRecordIdentity\((\{[^}]*\})/)[1])
  }
  const value = 'Crème with berries'
  const details = await trace(caller)
  assert.equal(details.backing, 'items')
  const proof = { ...details, value, key: 'record:' + details.id + ':' + value }
  const files = planRecordRadius(root, { recordScope: proof, property: 'border-radius', requested: '17px' })
  assert.match(files.get('Gallery.jsx').updated, /items\.includes\(entry\)/)
  const projected = files.get('Gallery.jsx').updated
  writeFileSync(join(root, 'Tile.jsx'), files.get('Tile.jsx').updated)
  const revised = await trace(projected)
  assert.ok(revised)
  assert.equal(await trace(projected.replace('items.includes(entry)', 'true')), undefined)
  writeFileSync(join(root, 'Tile.jsx'), renderer)
  assert.equal(await trace(caller.replace('needle === entry.slug', 'needle === entry.cost')), undefined)
  assert.equal(await trace(caller.replace('!!hit', 'true')), undefined)
  assert.equal(await trace(caller.replace("from 'react'", "from 'not-react'")), undefined)
  assert.equal(
    await trace(
      caller.replace('({items})', '({items,other})').replace('useProjection(items)', 'useProjection(items,other)'),
    ),
    undefined,
  )
  writeFileSync(join(root, 'Tile.jsx'), renderer.replace("from 'react'", "from 'custom'"))
  assert.equal(await trace(caller), undefined)
})

test('a filtered singleton cannot hide a duplicate identity or substitute a different record object', async () => {
  const previous = globalThis.document
  globalThis.document = new EventTarget()
  try {
    const { recordIdentity, recordAttributes } = await import('../integrations/prepared-registry.mjs')
    const proof = { id: 'b'.repeat(24), file: 'Tile.jsx', owner: 'Tile' },
      row = { slug: 'Crème with berries' },
      other = { ...row }
    const keys = (visible, backing) =>
      visible.map(
        recordIdentity(
          proof,
          visible,
          'slug',
          (get) => (r) => recordAttributes(get(r), 'Tile.jsx', 'Tile')['data-inspector-target'],
          backing,
        ),
      )
    assert.ok(keys([row], [row])[0])
    assert.deepEqual(keys([row], [row, other]), [undefined])
    assert.deepEqual(keys([other], [row]), [undefined])
    assert.deepEqual(keys([row, row], [row]), [undefined, undefined])
  } finally {
    globalThis.document = previous
  }
})
