import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parseAuthoredJsx } from './authored-forwarding.mjs'
import { localBindingNames } from './authored-use.mjs'
import { preparedOpenings } from './prepared-site-qualification.mjs'
import { reactReference, renderOwnerFunction, walk } from './record-render-path.mjs'
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

// React can retain a different component's output between the keyed caller
// and its painted host. Register actual component values from loaded modules.
export function recordRenderOwners(tree) {
  const owners = new Map()
  for (const statement of tree.program.body) {
    const declaration = statement.declaration ?? statement
    const bindings = declaration.declarations ?? [declaration]
    for (const binding of bindings) {
      const name = binding.id?.name
      if (!name || !/^[A-Z]/.test(name)) continue
      const fn = renderOwnerFunction(tree, binding)
      if (fn?.body && !localBindingNames({program:fn}, new Set([fn])).has(name)) {
        owners.set(name, fn.body)
      }
    }
  }
  return owners
}

export function recordContractKey(proof, legacy = false) {
  const revisions = path => path.map(site=>[site.file,site.owner,site.revision])
  const identity = [proof.part.id,proof.anchor.id,proof.authority.file,proof.authority.id,
    proof.field,proof.value,proof.witness,proof.part.revision,proof.anchor.revision,
    proof.authority.revision,revisions(proof.renderPath)]
  if (!legacy && proof.statePath) identity.push(revisions(proof.statePath))
  return 'bound:'+createHash('sha256').update(JSON.stringify(identity)).digest('hex')
}

export function verifyRuntimeRecord(root,proof) {
  if (proof?.kind==='state-record' && !Array.isArray(proof.statePath)) {
    const error = Error('This earlier record edit needs its state path verified. Reapply the edit on the selected record.')
    error.code = 'record-state-path-unverified'
    throw error
  }
  if(proof?.kind!=='state-record' || !['border-radius','background-color'].includes(proof.operation) ||
      !['string','number'].includes(typeof proof.value) ||
      (typeof proof.value==='number' && !Number.isSafeInteger(proof.value)) ||
      String(proof.value).length>70 || !String(proof.value).trim() ||
      typeof proof.witness!=='string' || !proof.witness.length || proof.witness.length>4096 ||
      !/^[a-zA-Z_$][\w$]*$/.test(proof.field) ||
      ![proof.part,proof.anchor,proof.authority].every(site=>site?.file && site.id) ||
      (!Array.isArray(proof.renderPath) || proof.renderPath.length>12 ||
        proof.statePath.length>12 || ![...proof.renderPath,...proof.statePath].every(site=>site?.file && site.owner && site.revision)) ||
      (proof.requalifiedKey !== undefined && proof.requalifiedKey !== recordContractKey(proof,true)) ||
      proof.key!==recordContractKey(proof)) throw Error('Invalid selected record contract.')
  const sources=new Map()
  for(const site of [proof.part,proof.anchor,proof.authority,...proof.renderPath,...proof.statePath]){
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
    if (proof.renderPath.includes(site) || proof.statePath.includes(site)) {
      if (!recordRenderOwners(tree).has(site.owner)) throw Error('Record render owner changed.')
      continue
    }
    let count=0
    for(const {node,owner} of preparedOpenings(tree)){
      if(owner.id?.name!==site.owner || sourceUseId(site.file,site.owner,code.slice(node.start,node.end))!==site.id)continue
      if(site===proof.anchor && recordKeyInput(node)?.field!==proof.field)continue
      count++
    }
    if(count!==1)throw Error('Record contract source is ambiguous.')
  }
}

