import assert from 'node:assert/strict'
import { mkdtempSync,realpathSync,writeFileSync,rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import MagicString from 'magic-string'
import { markSelectedCalls,verifySelectedUse } from '../scripts/flow/selected-use.mjs'
import { parseAuthoredJsx } from '../scripts/flow/authored-forwarding.mjs'
import { buildSourceHandoff } from '../source-handoff.mjs'
import { completeHandoff } from '../complete-handoff.mjs'

test('selected component invocation survives a value repeat and rejects changed source, list callbacks and shadowed calls', async t=>{
  const dir=realpathSync(mkdtempSync(join(tmpdir(),'selected-use-')))
  t.after(()=>rmSync(dir,{recursive:true,force:true}))
  const code='import Action from "./Action"; export function Home({items}) { return <main><Action label="Create"/>{items.map(x=><Action label="Item"/>)}</main> }'
  const component='export default function Action({label}) { return <button>{label}</button> }'
  writeFileSync(join(dir,'Home.jsx'),code);writeFileSync(join(dir,'Action.jsx'),component)
  async function compile(source,resolver=async()=>join(dir,'Action.jsx')){
    const out=new MagicString(source)
    await markSelectedCalls(dir,'Home.jsx',source,parseAuthoredJsx(source),out,resolver)
    parseAuthoredJsx(out.toString())
    return out.toString()
  }
  await compile(code.replace('x=><Action label="Item"/>','x=><li><Action label="Item"/></li>'))
  const memoCall = code.replace('export function Home({items}) {','import {memo as wrap} from "react";export const Home = wrap(function Home({items}) {') + ')'
  assert.match(await compile(memoCall), /"callerDigest"/)
  assert.doesNotMatch(await compile(memoCall.replace('from "react"', 'from "custom"')), /"callerDigest"/)
  assert.doesNotMatch(await compile(memoCall.replace('function Home({items})', 'function Home({items,wrap})')), /"callerDigest"/)
  const compiled=await compile(code)
  assert.match(compiled,/__liSelectedCall\(<Action label="Item"\/>\)/)
  const match=compiled.match(/__liSelectedCall\(<Action label="Create"\/>,(\{[^}]+\}),\["label"\]\)/)
  assert.ok(match)
  const proof={...JSON.parse(match[1]),field:'label',dependencies:[]}
  verifySelectedUse(dir,proof)
  assert.doesNotMatch(await compile(code.replace('Home({items})','Home({items,Action})')),/"callerDigest"/)
  assert.doesNotMatch(await compile(code,async()=>{throw Error('missing import')}),/"callerDigest"/)
  assert.doesNotMatch(await compile(code.replace('<Action label="Create"/>','<Action label="Create"/><Action label="Create"/>')),/"callerDigest"/)
  writeFileSync(join(dir,'Action.jsx'),component+'\n')
  assert.throws(()=>verifySelectedUse(dir,proof),/source changed/)
  const record={route:'/',intent:'selected occurrence only',target:{tag:'button'},restore:'unique',property:'height',selectedUse:proof}
  const journal={revision:2,edits:[{...record,id:'first',requested:'56px'},{...record,id:'last',requested:'60px'}]}
  const binding={id:'project'}
  assert.deepEqual(buildSourceHandoff(binding,journal).operations.map(o=>[o.id,o.scope]),[['last','selected-use']])
  const report={projectId:binding.id,verified:[{id:'last',summary:'ordinary caller and protected peers verified'}]}
  assert.deepEqual(completeHandoff(binding,journal,report,Date.now()).retired,['first','last'])
})

test('a moved component can load independently of its original route module', async () => {
  const code = 'function Details() { "use strict"; return 7 }'
  const out = new MagicString(code)
  await markSelectedCalls('.', 'Route.jsx', code, parseAuthoredJsx(code), out, async () => null)
  const result = out.toString()
  const tree = parseAuthoredJsx(result)
  const route = tree.program.body.find(node => node.type === 'FunctionDeclaration')
  assert.equal(route.body.directives[0].value.value, 'use strict')

  // A route splitter extracts the component declaration into another module.
  const shell = tree.program.body
    .filter(node => node !== route && node.type !== 'ImportDeclaration')
    .map(node => result.slice(node.start, node.end))
    .join('\n').replaceAll('import.meta.url', JSON.stringify('file:///route.js'))
  const seen = []
  const register = (file, owner, component) => seen.push([file, owner, component])
  Function('__liSelectedModule', '__liRenderOwners', shell)(() => {}, register)
  assert.equal(seen.length, 0)
  const details = Function('__liRenderOwners', result.slice(route.start, route.end) + ';return Details')(register)
  assert.equal(details(), 7)
  assert.deepEqual(seen, [['Route.jsx', 'Details', details]])
})
