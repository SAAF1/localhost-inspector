import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { parse } from '@babel/parser'
import { componentPreviewSites } from '../scripts/flow/component-preview-sites.mjs'

test('an Inspector build binds imported slot contracts to the rendered component and tracks type changes', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'preview-contract-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const types = join(root, 'props.ts')
  await writeFile(types, "export type TileProps = { tone: 'quiet' | 'loud', children: React.ReactNode }")
  const plugin = componentPreviewSites(root)
  const watched = new Set()
  const code = `import React from 'react'
    import type { TileProps } from './props'
    const Tile = React.memo(({tone = 'quiet', children}: TileProps) => (
      <section className={tone}>{children}</section>
    ))
    function PlainRow() { return <div data-slot="row" /> }`
  const compile = () => plugin.transform.call({ addWatchFile: path => watched.add(path) }, code, join(root, 'Tile.tsx')).code
  const first = compile()
  assert.doesNotThrow(() => parse(first, { sourceType: 'module', plugins: ['jsx','typescript'] }))
  assert.deepEqual([...watched], [types])
  assert.equal(first.split('data-inspector-instance').length - 1, 1)
  assert.match(first, /"tone":\["quiet","loud"\]/)
  assert.match(first, /const \{tone = 'quiet', children\} = __liPreview\.props/)
  await writeFile(types, "export type TileProps = { tone: 'quiet' | 'saturated', children: React.ReactNode }")
  assert.match(compile(), /"tone":\["quiet","saturated"\]/)
})

test('conditional host markers require the opt-in and an actual intrinsic branch', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'conditional-contract-')))
  t.after(() => rm(root, { recursive:true, force:true }))
  const code = `import React from 'react'
    import {Slot} from 'ui'
    export function Chip({asChild, tone = 'quiet'}: {asChild: boolean, tone: 'quiet' | 'loud'}) {
      const Tag = asChild ? Slot : 'button'
      return <Tag className={tone}/>
    }`
  const compile = (input, optIn) => {
    const {transform}=componentPreviewSites(root,{conditionalHosts:optIn})
    if (optIn) assert.equal(transform.order,'pre')
    return (transform.handler ?? transform).call({addWatchFile(){}},input,join(root,'Chip.tsx'))?.code
  }
  assert.equal(compile(code,false),undefined)
  const prepared = compile(code,true)
  assert.match(prepared,/typeof Tag === "string" \? \{"data-inspector-source"/)
  assert.doesNotThrow(()=>parse(prepared,{sourceType:'module',plugins:['jsx','typescript']}))
  assert.equal(compile(code.replace("'button'","Other"),true),undefined)
})
