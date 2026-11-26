import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parseAuthoredJsx } from './authored-forwarding.mjs'
import { localBindingNames } from './authored-use.mjs'
import { reactReference, walk } from './record-render-path.mjs'
import { sourceUseId } from './selection-provenance.mjs'
import { syntaxFingerprint } from './component-proof.mjs'

export function recordKeyInput(opening) {
  if (opening.attributes.some(a=>a.type==='JSXSpreadAttribute')) return
  const keys=opening.attributes.filter(a=>a.name?.name==='key')
  const expr=keys.length===1 && keys[0].value?.expression
  if (expr?.type==='MemberExpression' && !expr.computed && expr.object.type==='Identifier' &&
      expr.property.type==='Identifier') return {variable:expr.object.name,field:expr.property.name}
}

// Observe the actual value of a project-owned state hook without changing the
// hook tuple, initializer, reducer, dispatch or application objects.
function stateAuthorities(tree) {
  const locals=localBindingNames(tree)
  const bindings=new Map()
  walk(tree.program,(node,owner)=>{
    if (!owner || node.type!=='VariableDeclarator' || node.id.type!=='ArrayPattern' ||
        node.id.elements[0]?.type!=='Identifier' || node.init?.type!=='CallExpression') return
    if (!['useState','useReducer'].some(hook=>reactReference(tree,node.init.callee,hook,locals)))return
    const signature=syntaxFingerprint(node)
    bindings.set(signature,bindings.has(signature)?null:node.init)
  })
  return bindings
}

export function markStateAuthorities(file,tree,out) {
  let changed=false
  for(const [id,call] of stateAuthorities(tree)){
    if(!call)continue
    out.prependRight(call.start,'__liRecordState(')
    out.appendLeft(call.end,','+JSON.stringify({file,id})+')')
    changed=true
  }
  if(changed)out.prepend('import { recordState as __liRecordState } from "virtual:inspector-selected-use";\n')
  return changed
}

export function recordContractKey(proof) {
  return 'bound:'+createHash('sha256').update(JSON.stringify([proof.part.id,proof.anchor.id,
    proof.authority.file,proof.authority.id,proof.field,proof.value,proof.witness])).digest('hex')
}

export function verifyRuntimeRecord(root,proof) {
  if(proof?.kind!=='state-record' || proof.operation!=='border-radius' ||
      !['string','number'].includes(typeof proof.value) ||
      (typeof proof.value==='number' && !Number.isSafeInteger(proof.value)) ||
      String(proof.value).length>70 || !String(proof.value).trim() ||
      typeof proof.witness!=='string' || !proof.witness.length || proof.witness.length>4096 ||
      !/^[a-zA-Z_$][\w$]*$/.test(proof.field) ||
      ![proof.part,proof.anchor,proof.authority].every(site=>site?.file && site.id) ||
      proof.key!==recordContractKey(proof)) throw Error('Invalid selected record contract.')
  const sources=new Map()
  for(const site of [proof.part,proof.anchor,proof.authority]){
    if(!/^[\w./ -]+\.[jt]sx?$/.test(site.file) || site.file.split('/').some(p=>!p||p==='..'||p==='node_modules'))throw Error('Invalid record source path.')
    const path=join(root,site.file)
    if(relative(root,path)!==site.file || realpathSync(path)!==path)throw Error('Record source moved.')
    if(!sources.has(path)){
      const code=readFileSync(path,'utf8')
      if(code.length>1024*1024)throw Error('Record source too large.')
      const tree=parseAuthoredJsx(code)
      sources.set(path,{tree,code,revision:syntaxFingerprint(tree.program)})
    }
    const {tree,code,revision}=sources.get(path)
    if(revision!==site.revision)throw Error('Record contract source changed.')
    if(site===proof.authority){
      if(!stateAuthorities(tree).get(site.id))throw Error('Record state authority changed.')
      continue
    }
    let count=0
    walk(tree.program,node=>{
      if(node.type!=='JSXOpeningElement' || sourceUseId(site.file,site.owner,code.slice(node.start,node.end))!==site.id)return
      if(site===proof.anchor && recordKeyInput(node)?.field!==proof.field)return
      count++
    })
    if(count!==1)throw Error('Record contract source is ambiguous.')
  }
}

