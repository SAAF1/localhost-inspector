import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import MagicString from 'magic-string'
import { parseAuthoredJsx } from '../scripts/flow/authored-forwarding.mjs'
import { markRecordCallers, markRecordHost, verifyRecordSource } from '../scripts/flow/record-scope.mjs'
import { planRecordRadius, planRecordRadii } from '../scripts/flow/record-radius.mjs'
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
  const sibling = { ...proof, value: 'other', key: 'record:' + proof.id + ':other' }
  const sharedHost = planRecordRadii(root, [change, { ...change, recordScope: sibling, requested: '31px' }])
  assert.equal(sharedHost.get('Tile.jsx').updated, retained.get('Tile.jsx').updated)
  assert.match(sharedHost.get('Shelf.jsx').updated, /17px.*other.*31px/)
  assert.throws(() => planRecordRadii(root, [change, change]), /distinct values/)
  assert.throws(() => planRecordRadii(root, [change, { ...change, recordScope: { ...sibling, field: 'wrong' } }]))
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
  const combined = planRecordRadii(root, [
    { ...change, recordScope: current, requested: '23px' },
    { ...change, recordScope: other, requested: '9px' },
  ])
  assert.deepEqual([...combined.keys()], ['Shelf.jsx'])
  assert.match(combined.get('Shelf.jsx').updated, /23px.*different.*9px/)
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

test('an unrelated memo component with effect statements is left untouched', () => {
  const source = 'import {memo,useEffect} from "react"; export const Search=memo(function Search({row}) { useEffect(()=>{},[]); return <div>{row.name}</div> })'
  const tree = parseAuthoredJsx(source)
  const fn = tree.program.body[1].declaration.declarations[0].init.arguments[0]
  const node = fn.body.body.at(-1).argument.openingElement
  const out = new MagicString(source)
  assert.equal(markRecordHost(tree, node, fn, 'Search.jsx', out), undefined)
  assert.equal(out.toString(), source)
})

test('a checked-in complete data source qualifies typed keys across projections and refuses recycled or ambiguous records', async t => {
  const { mkdirSync } = await import('node:fs')
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'record-public-')))
  t.after(() => rmSync(root, {recursive:true,force:true}))
  mkdirSync(join(root,'public'))
  const data = [{code: 8, title: 'River'}, {code: 19, title:'Bay'}]
  const resource = join(root,'public','inventory.json')
  const publish = rows => writeFileSync(resource,JSON.stringify(rows))
  publish(data)
  const source = `import {useRef,useState} from 'react';
    function Catalog(){
      const [visible,show]=useState([]); const all=useRef([]);
      async function load(){const response=await fetch('/inventory.json');const rows=await response.json();
        all.current=rows;show(rows)}
      return <main>{visible.map(row=><Panel key={row.code} item={row}/>)}</main>
    }
    function Panel({item}){return <><section>{item.title}</section></>}`
  const file='Catalog.jsx'
  const watched = new Set()
  const trace = async (code=source) => {
    writeFileSync(join(root,file),code)
    const tree=parseAuthoredJsx(code),out=new MagicString(code)
    const marked=await markRecordCallers({root,file,code,tree,out,allowPublic:true,watchFile:path=>watched.add(path),resolveImport:()=>null})
    if (!marked) return
    parseAuthoredJsx(out.toString())
    const proof=JSON.parse(out.toString().match(/map\(__liRecordIdentity\((\{[^}]*\}),/)[1])
    const entries=JSON.parse(out.toString().match(/const __liRecordRows[a-f0-9]+ = (.*);/)[1])
    return {proof,entries}
  }
  const {proof,entries}=await trace()
  const original=globalThis.document, where=globalThis.location
  globalThis.document={baseURI:'http://localhost/',addEventListener(){}}
  globalThis.location={origin:'http://localhost'}
  t.after(()=>{globalThis.document=original;globalThis.location=where})
  const {recordIdentity}=await import('../integrations/prepared-registry.mjs')
  const keys=(visible,all=data)=>recordIdentity(proof,visible,'code',lookup=>visible.map(item=>JSON.parse(lookup(item))),all,entries)
  const [one,two]=keys(data)
  assert.equal(one.value,8);assert.ok(one.key);assert.ok(two.key)
  verifyRecordSource(root,one)
  assert.deepEqual(keys([data[1],data[0]]),[two,one])
  assert.deepEqual(keys([data[0]]),[one])
  assert.equal(keys([{...data[0]}])[0].key,undefined)
  assert.equal(keys([data[0]],[data[0],{...data[1],code:'8'}])[0].key,undefined)
  const reused={...data[0],title:'different'}
  assert.equal(keys([reused],[reused,data[1]])[0].key,undefined)
  publish(data.toReversed());verifyRecordSource(root,one)
  for (const rows of [[reused,data[1]], [data[1]], [data[0], {...data[1],code:'8'}]]) {
    publish(rows);assert.throws(()=>verifyRecordSource(root,one))
  }
  watched.clear()
  assert.equal(await trace(),undefined)
  assert.ok(watched.has(resource))
  publish(data)
  assert.equal(await trace(source.replace('return <main>', '{const all = null;return <main>').replace('</main>', '</main>}')),undefined)
  assert.equal(await trace(source.replace('all.current=rows','all.current=[]')),undefined)
  assert.equal(await trace(source.replace('/inventory.json','https://example.org/inventory.json')),undefined)
  assert.equal(await trace(source.replace('</section></>','</section><hr/></>')),undefined)
  assert.equal(await trace(source.replace('return <main>','const Panel=Other;return <main>')),undefined)
})

test('an evaluated project data import corroborates projected records across quantity changes and remounts', async t => {
  const {recordCatalog,recordCatalogRows,registerCatalogImport}=await import('../scripts/flow/record-catalog.mjs')
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'structural-record-')))
  t.after(()=>rmSync(dir,{recursive:true,force:true}))
  const source='import stock from "./stock.json";export const App=()=>null'
  const caller='import {Row} from "./Row";export function Orders({lines}){return lines.map(line=><Row key={line.code} entry={line}/>)}'
  const owner='export const Row=({entry})=><section style={{opacity:0.9}}>{entry.name}</section>'
  const data=[{code:11,name:'Oak',cost:4},{code:5,name:'Pine',cost:6}]
  for(const [file,code] of [['App.jsx',source],['Orders.jsx',caller],['Row.jsx',owner],['stock.json',JSON.stringify(data)]])writeFileSync(join(dir,file),code)
  const edge={importer:'App.jsx',file:'stock.json',specifier:'./stock.json'}
  assert.equal(recordCatalog(dir,[edge,edge]),undefined)
  const catalog=recordCatalog(dir,[edge]);assert.equal(catalog.binding,'stock')
  const entryOut=new MagicString(source);registerCatalogImport(entryOut,'App.jsx',catalog);parseAuthoredJsx(entryOut.toString())
  const tree=parseAuthoredJsx(caller),out=new MagicString(caller)
  assert.ok(await markRecordCallers({root:dir,file:'Orders.jsx',code:caller,tree,out,catalog,resolveImport:()=>join(dir,'Row.jsx')}))
  parseAuthoredJsx(out.toString())
  const proof=JSON.parse(out.toString().match(/map\(__liRecordIdentity\((.*?), lines, "code",/)[1])
  const entries=recordCatalogRows(dir,catalog,'code').entries
  const original=globalThis.document
  globalThis.document={addEventListener(){}}
  t.after(()=>{globalThis.document=original})
  const {registerRecordCatalog,recordIdentity}=await import('../integrations/prepared-registry.mjs')
  const keys=(rows,backing=rows)=>recordIdentity(proof,rows,'code',get=>rows.map(row=>JSON.parse(get(row))),backing,entries)
  const [a,b]=data.map(x=>({...x,quantity:1}))
  assert.equal(keys([a,b])[0].key,undefined)
  let dispose;registerRecordCatalog(catalog,data,{dispose:cb=>{dispose=cb}})
  const [first,second]=keys([a,b]);assert.ok(first.key&&second.key);verifyRecordSource(dir,first,catalog)
  assert.deepEqual(keys([{...b,quantity:8},{...a,quantity:2}]),[second,first])
  assert.deepEqual(keys([b],[a,b]),[second])
  assert.equal(keys([a],[a,{...a,code:'11'}])[0].key,undefined)
  assert.equal(keys([{...a,cost:7}])[0].key,undefined)
  assert.equal(keys([a],[{...a}])[0].key,undefined)
  assert.throws(()=>verifyRecordSource(dir,first,undefined))
  dispose();assert.equal(keys([a])[0].key,undefined)
  writeFileSync(join(dir,'stock.json'),JSON.stringify([{...data[0],name:'Willow'},data[1]]))
  assert.throws(()=>verifyRecordSource(dir,first,catalog))
})
