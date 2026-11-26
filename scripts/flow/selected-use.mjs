import { recordKeyInput, markStateAuthorities, recordRenderOwners } from './runtime-record-contract.mjs'
import { syntaxFingerprint } from './component-proof.mjs'
import { renderOwnerFunction } from './record-render-path.mjs'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createComponentTypeResolver, typeModule } from '../../component-types.mjs'
import { parseAuthoredJsx } from './authored-forwarding.mjs'
import { localBindingNames } from './authored-use.mjs'
import { sourceUseId } from './selection-provenance.mjs'

const safeFile = file => typeof file === 'string' && file.length <= 240 &&
  /^[\w./ -]+\.[jt]sx?$/.test(file) && !file.startsWith('/') && !file.split('/').some(part => ['..','node_modules','.git'].includes(part))
const digest = value => createHash('sha256').update(value).digest('hex')

// Limit eligibility to a named top-level component's direct render, outside
// callbacks, keys and loops. A static label is a candidate input, never identity.
function candidates(file, code, tree, repeatedCalls) {
  const { imports } = typeModule(tree, file)
  const locals = localBindingNames(tree)
  const found = new Map()
  function visit(n, parent, owner, repeated = false) {
    if (!n?.type) return
    repeated ||= /Function|Method|^For|^While|^DoWhile|^ArrayExpression$/.test(n.type)
    if (repeated && !repeatedCalls) return
    if (n.type === 'JSXElement') {
      const opening = n.openingElement
      repeated ||= opening.attributes.some(a => a.name?.name === 'key')
      const name = opening.name.name
      const child = parent?.type === 'JSXElement' || parent?.type === 'JSXFragment'
      const recordKey = repeatedCalls && recordKeyInput(opening)
      if (recordKey) {
        const id=sourceUseId(file,owner,code.slice(opening.start,opening.end))
        repeatedCalls.push({n,child,recordKey:{...recordKey,id,file,owner}})
      }
      if (repeated && (opening.name.type === 'JSXMemberExpression' || /^[A-Z]/.test(name))) {
        if(!recordKey) repeatedCalls?.push({n,child})
        return
      }
      const imported = repeated ? undefined : imports.get(name)
      if (imported?.from.startsWith('.') && !locals.has(name) &&
          !opening.attributes.some(a => a.type === 'JSXSpreadAttribute')) {
        const fields = opening.attributes.filter(a => a.value?.type === 'StringLiteral' &&
          typeof a.name?.name === 'string' && a.value.value.trim() &&
          a.value.value.length <= 160).map(a => a.name.name)
        if (fields.length) {
          const id = sourceUseId(file, owner, code.slice(opening.start, opening.end))
          found.set(id, found.has(id) ? null : {id,owner,n,fields,spec:imported.from,
            child})
        }
      }
    }
    for (const value of Object.values(n)) {
      if (Array.isArray(value)) for (const item of value) visit(item, n, owner, repeated)
      else if (value?.type) visit(value, n, owner, repeated)
    }
  }
  for (const statement of tree.program.body) {
    const d = statement.declaration ?? statement
    if (d.type === 'FunctionDeclaration' && /^[A-Z]/.test(d.id?.name)) visit(d.body,d,d.id.name)
    for (const variable of d.declarations ?? []) {
      const fn = renderOwnerFunction(tree, variable)
      if (fn) visit(fn.body, fn, variable.id.name)
    }
  }
  return [...found.values()].filter(Boolean)
}

export async function markSelectedCalls(root,file,code,tree,out,resolveImport) {
  if (!safeFile(file) || code.length > 1024*1024 || /\b__li(?:SelectedCall|SelectedModule|RenderOwners|RecordState)\b/.test(code)) return false
  const repeated = []
  const candidatesHere = candidates(file,code,tree,repeated)
  const revision=syntaxFingerprint(tree.program)
  markStateAuthorities(file,tree,out)
  out.prepend('import { selectedModule as __liSelectedModule } from "virtual:inspector-selected-use";__liSelectedModule(import.meta.url,'+
    JSON.stringify(file)+','+JSON.stringify(digest(code))+','+JSON.stringify(revision)+');\n')
  const renderOwners = recordRenderOwners(tree)
  if (renderOwners.length) {
    out.prepend('import { registerRenderOwners as __liRenderOwners } from "virtual:inspector-selected-use";\n')
    out.append('\n__liRenderOwners(' + JSON.stringify(file) + ',{' + renderOwners.join(',') + '});\n')
  }
  function wrap(n,child,args) {
    // Keep the wrapper inside its JSX span. A concise map callback may have
    // its own record arguments appended immediately after that same JSX.
    out.prependRight(n.start,(child ? '{' : '')+'__liSelectedCall(')
    out.prependLeft(n.end,args+')'+(child ? '}' : ''))
  }
  for (const {n,child,recordKey} of repeated) {
    const {variable,...site}=recordKey ?? {}
    wrap(n,child,recordKey?',null,null,'+JSON.stringify(site)+','+variable:'')
  }
  const resolveLocal = createComponentTypeResolver(root)
  const imports = new Map()
  const callerDigest = digest(code)
  let changed = repeated.length > 0
  for (const {id,owner,n,fields,spec,child} of candidatesHere) {
    if (!imports.has(spec)) {
      imports.set(spec,null)
      try {
        const resolved = await resolveImport(spec)
        const local = resolveLocal(file,spec)?.module?.file
        const path = local && join(root,local)
        if (path && safeFile(local) && resolved === path && realpathSync(path) === path)
          imports.set(spec,{component:local, componentDigest:digest(readFileSync(path))})
      } catch { /* An unavailable optional use must not interrupt the app transform. */ }
    }
    const component = imports.get(spec)
    if (!component) continue
    const basis = {id,file,owner,callerDigest,...component}
    wrap(n,child,','+JSON.stringify(basis)+','+JSON.stringify(fields))
    changed = true
  }
  if (changed) out.prepend('import { selectedCall as __liSelectedCall } from "virtual:inspector-selected-use";\n')
  return true
}

export function verifySelectedUse(root, proof) {
  if (!safeFile(proof?.file) || !safeFile(proof.component)) throw Error('Invalid selected-use source path.')
  const read = file => {
    const path = join(root,file)
    if (statSync(path).size > 1024*1024 || realpathSync(path) !== path || relative(root,path).startsWith('..')) throw Error('Selected source moved.')
    return readFileSync(path,'utf8')
  }
  const code = read(proof.file)
  if (!Array.isArray(proof.dependencies) || proof.dependencies.length > 12 ||
      proof.dependencies.some(d => !safeFile(d?.file) || digest(read(d.file)) !== d.revision) ||
      digest(code) !== proof.callerDigest || digest(read(proof.component)) !== proof.componentDigest)
    throw Error('Selected source changed. Reopen the candidate and verify the action again.')
  const use = candidates(proof.file,code,parseAuthoredJsx(code)).find(c => c.id === proof.id && c.owner === proof.owner)
  if (!use?.fields.includes(proof.field) || createComponentTypeResolver(root)(proof.file,use.spec)?.module?.file !== proof.component)
    throw Error('The selected action no longer has its original caller and input.')
}
