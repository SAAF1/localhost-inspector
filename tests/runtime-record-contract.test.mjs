import assert from 'node:assert/strict'
import {mkdtempSync,realpathSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import test from 'node:test'
import MagicString from 'magic-string'
import {parseAuthoredJsx} from '../scripts/flow/authored-forwarding.mjs'
import {markStateAuthorities,recordKeyInput,recordContractKey,verifyRuntimeRecord} from '../scripts/flow/runtime-record-contract.mjs'
import {syntaxFingerprint} from '../scripts/flow/component-proof.mjs'
import {sourceWinners} from '../source-handoff.mjs'
import {sourceUseId} from '../scripts/flow/selection-provenance.mjs'

test('state-record handoff rechecks the real hook, rendered part, key and current source',t=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'runtime-record-')))
  t.after(()=>rmSync(root,{recursive:true,force:true}))
  const code="import {useReducer as useRows} from 'react';export function Board(){const [rows,send]=useRows(reduce,initial);return <main>{rows.map(row=><li key={row.uid}><article>{row.title}</article></li>)}</main>}"
  writeFileSync(join(root,'Board.jsx'),code)
  const tree=parseAuthoredJsx(code),out=new MagicString(code)
  assert.ok(markStateAuthorities('Board.jsx',tree,out))
  const revision=syntaxFingerprint(tree.program)
  const authority={...JSON.parse(out.toString().match(/__liRecordState\(useRows\(reduce,initial\),(\{.*?\})\)/)[1]),revision}
  function site(opening){return {file:'Board.jsx',owner:'Board',revision,id:sourceUseId('Board.jsx','Board',opening)}}
  const proof={kind:'state-record',operation:'border-radius',part:site('<article>'),
    anchor:site('<li key={row.uid}>'),field:'uid',value:'oak',authority,witness:'[["title","Oak"]]',members:2,renderPath:[],statePath:[]}
  proof.key=recordContractKey(proof)
  assert.doesNotThrow(()=>verifyRuntimeRecord(root,proof))
  writeFileSync(join(root,'Board.jsx'),code+'\n// harmless')
  assert.doesNotThrow(()=>verifyRuntimeRecord(root,proof))
  for(const changed of [code.replace('row.uid','row.index'),code.replace('<article>','<article hidden>'),code.replace('useRows(reduce,initial)','useRows(other,initial)')]){
    writeFileSync(join(root,'Board.jsx'),changed)
    assert.throws(()=>verifyRuntimeRecord(root,proof))
  }
  writeFileSync(join(root,'Board.jsx'),code)
  const invalid={...proof,authority:{...authority,id:syntaxFingerprint(tree.program.body[0])}}
  invalid.key=recordContractKey(invalid)
  assert.throws(()=>verifyRuntimeRecord(root,invalid))
  const mislabeled = {...proof,part:{...proof.part,owner:'Other',id:sourceUseId('Board.jsx','Other','<article>')}}
  mislabeled.key=recordContractKey(mislabeled)
  assert.throws(()=>verifyRuntimeRecord(root,mislabeled))
  const intermediate = "export function Relay({row}){return <Board row={row}/>}"
  writeFileSync(join(root,'Relay.jsx'),intermediate)
  const withRelay={...proof,renderPath:[{file:'Relay.jsx',owner:'Relay',revision:syntaxFingerprint(parseAuthoredJsx(intermediate).program)}]}
  withRelay.key=recordContractKey(withRelay)
  assert.notEqual(withRelay.key,proof.key)
  assert.doesNotThrow(()=>verifyRuntimeRecord(root,withRelay))
  writeFileSync(join(root,'Relay.jsx'),intermediate.replace('<Board row={row}/>','<p>Other</p>'))
  assert.throws(()=>verifyRuntimeRecord(root,withRelay))
  const oldProof={...proof}
  delete oldProof.statePath
  oldProof.key=recordContractKey(oldProof)
  assert.throws(()=>verifyRuntimeRecord(root,oldProof), {code:'record-state-path-unverified'})
  const renewed={...proof,requalifiedKey:oldProof.key}
  assert.doesNotThrow(()=>verifyRuntimeRecord(root,renewed))
  const edits=[oldProof,renewed].map((recordScope,i)=>({id:String(i),property:'border-radius',recordScope}))
  assert.equal(sourceWinners({edits}).get('0').member,'1')
  assert.equal(sourceWinners({edits:[edits[0]]}).get('0').member,'0')
  assert.throws(()=>verifyRuntimeRecord(root,{...renewed,requalifiedKey:proof.key}))
  writeFileSync(join(root,'Relay.jsx'),intermediate)
  const dataBridge={...proof,statePath:withRelay.renderPath}
  dataBridge.key=recordContractKey(dataBridge)
  assert.doesNotThrow(()=>verifyRuntimeRecord(root,dataBridge))
  writeFileSync(join(root,'Relay.jsx'),intermediate.replace('row={row}','row={{...row}}'))
  assert.throws(()=>verifyRuntimeRecord(root,dataBridge))
  const shadow=code.replace('function Board()','function Board(useRows)')
  assert.equal(markStateAuthorities('Board.jsx',parseAuthoredJsx(shadow),new MagicString(shadow)),false)
  const lookalike=code.replace("from 'react'","from './react-like'")
  assert.equal(markStateAuthorities('Board.jsx',parseAuthoredJsx(lookalike),new MagicString(lookalike)),false)
  assert.equal(recordKeyInput(parseAuthoredJsx('const el=<li key={index}/>').program.body[0].declarations[0].init.openingElement),undefined)
})

