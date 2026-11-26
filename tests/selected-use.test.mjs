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
