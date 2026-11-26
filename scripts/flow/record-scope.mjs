import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { localBindingNames } from './authored-use.mjs'
import { authoredImports, parseAuthoredJsx } from './authored-forwarding.mjs'

const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 24)
const markerProp = '__inspectorRecordScope'
const scalar = /^[a-zA-Z0-9_./:-]{1,70}$/
const names = /^[A-Za-z_$][\w$]*$/
const member = (node, method) => node?.type === 'MemberExpression' && !node.computed &&
  node.property.type === 'Identifier' && (!method || node.property.name === method)
const identifier = (node, name) => node?.type === 'Identifier' && (!name || node.name === name)

function walk(node, visit) {
  if (!node?.type) return
  visit(node)
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) for (const item of child) walk(item, visit)
    else if (child?.type) walk(child, visit)
  }
}

function mappedUses(tree) {
  const imports = authoredImports(tree)
  const locals = localBindingNames(tree)
  const uses = []
  walk(tree.program, node => {
    if (node.type !== 'CallExpression' || !member(node.callee, 'map') || !identifier(node.callee.object)) return
    const [fn] = node.arguments
    if (node.arguments.length !== 1 || fn?.type !== 'ArrowFunctionExpression' || fn.params.length !== 1 ||
      !identifier(fn.params[0]) || fn.body.type !== 'JSXElement') return
    const opening = fn.body.openingElement
    const imported = imports.get(opening.name.name)
    if (!imported || locals.has(opening.name.name) || !imported.specifier.startsWith('.') || opening.attributes.some(a =>
      a.type === 'JSXSpreadAttribute' || a.name?.name === markerProp)) return
    const item = fn.params[0].name
    const key = opening.attributes.find(a => a.name.name === 'key')?.value?.expression
    if (!member(key) || !identifier(key.object, item)) return
    const field = key.property.name
    const records = opening.attributes.filter(a => a.name.name !== 'key' && identifier(a.value?.expression, item))
    if (records.length !== 1) return
    // A separate application membership lookup must consume the same identity.
    const corroborated = opening.attributes.some(a => {
      const expr = a.value?.expression
      return expr?.type === 'CallExpression' && member(expr.callee, 'includes') && identifier(expr.callee.object) &&
        expr.arguments.length === 1 && member(expr.arguments[0], field) && identifier(expr.arguments[0].object, item)
    })
    if (corroborated) uses.push({ fn, opening, imported, item, field, collection: node.callee.object.name, prop: records[0].name.name })
  })
  return uses
}

function componentRoot(tree, exported, prop) {
  const fn = tree.program.body.find(s => s.type === 'ExportNamedDeclaration' &&
    s.declaration?.type === 'FunctionDeclaration' && s.declaration.id.name === exported)?.declaration
  const params = fn?.params[0]
  if (params?.type !== 'ObjectPattern' || fn.params.length !== 1 || params.properties.some(p =>
    p.type !== 'ObjectProperty' || p.computed || p.key.name === markerProp)) return
  const record = params.properties.find(p => p.key.name === prop && identifier(p.value))?.value.name
  if (!record) return
  const statement = fn.body.body[0]
  const root = statement?.type === 'ReturnStatement' && statement.argument?.type === 'JSXElement' && statement.argument.openingElement
  if (fn.body.body.length !== 1 || !/^[a-z][a-z0-9]*$/.test(root?.name.name ?? '') ||
    root.attributes.some(a => a.type === 'JSXSpreadAttribute' || ['style','data-inspector-target','data-li-record-scope'].includes(a.name?.name))) return
  let rendersRecord = false
  walk(statement.argument, node => {
    if (node.type === 'JSXExpressionContainer' && member(node.expression) && identifier(node.expression.object, record)) rendersRecord = true
  })
  if (rendersRecord) return { root, fn, params }
}

function checkedSource(root, file) {
  if (!/^(?!.*(?:^|\/)\.\.(?:\/|$))[\w./-]+\.[jt]sx$/.test(file) || file.startsWith('/') ||
    file.split('/').includes('node_modules')) throw Error('Unverified record source.')
  const path = resolve(root, file)
  if (relative(root, path) !== file || realpathSync(path) !== path) throw Error('Unverified record source.')
  return readFileSync(path, 'utf8')
}

function useIdentity(caller, file, code, use, ownerSource, root) {
  return digest(JSON.stringify([caller, file, use.imported, use.collection, use.prop,
    code.slice(use.opening.start, use.opening.end), ownerSource.slice(root.start, root.end)]))
}

// Source-derived identity is a hint for selection; source handoff rechecks it independently.
export async function markRecordCallers({ root, file, code, tree, out, resolveImport }) {
  if (code.includes('__liRecordIdentity') || code.includes('__liScope')) return false
  const candidates = []
  for (const use of mappedUses(tree)) {
    const resolved = await resolveImport(use.imported.specifier)
    if (!resolved) continue
    const ownerFile = relative(root, resolved)
    let ownerCode, host
    try {
      ownerCode = checkedSource(root, ownerFile)
      host = componentRoot(parseAuthoredJsx(ownerCode), use.imported.exported, use.prop)
    } catch { continue }
    if (!host) continue
    const id = useIdentity(file, ownerFile, code, use, ownerCode, host.root)
    candidates.push({ use, ownerFile, id })
  }
  let marked = false
  for (const { use, ownerFile, id } of candidates) {
    if (candidates.filter(c => c.id === id).length !== 1) continue
    const proof = JSON.stringify({ id, caller: file, file: ownerFile, owner: use.imported.exported, prop: use.prop, field: use.field, collection: use.collection })
    out.appendLeft(use.fn.start, '__liRecordIdentity(' + proof + ', ' + use.collection + ', ' + JSON.stringify(use.field) + ', __liScope => (')
    out.appendLeft(use.fn.end, '))')
    out.appendLeft(use.opening.name.end, ' ' + markerProp + '={__liScope(' + use.item + ')}')
    marked = true
  }
  if (marked) out.prepend('import { recordIdentity as __liRecordIdentity } from "virtual:inspector-prepared-registry";\n')
  return marked
}

export function markRecordHost(tree, node, owner, file, out) {
  const props = owner.params?.[0]
  if (props?.type !== 'ObjectPattern') return
  for (const p of props.properties) {
    if (!p.key || componentRoot(tree, owner.id.name, p.key.name)?.root !== node) continue
    const proof = 'arguments[0]?.' + markerProp
    out.appendLeft(node.name.end,' {...__liRecordAttrs(' + proof + ', ' + JSON.stringify(file) + ', ' + JSON.stringify(owner.id.name) + ')}')
    return true
  }
}

export function verifyRecordSource(root, proof) {
  if (!proof || !scalar.test(proof.value) || typeof proof.value !== 'string' ||
    !/^[a-f0-9]{24}$/.test(proof.id) || !names.test(proof.owner) || !names.test(proof.prop) ||
    proof.key !== 'record:'+proof.id+':'+proof.value) throw Error('Invalid record identity.')
  const code = checkedSource(root, proof.caller), ownerCode = checkedSource(root, proof.file)
  const tree = parseAuthoredJsx(ownerCode)
  const host = componentRoot(tree, proof.owner, proof.prop)
  if (!host) throw Error('The selected component no longer has a unique native root.')
  const matches = mappedUses(parseAuthoredJsx(code)).filter(use => {
    const base = resolve(root, proof.caller, '..', use.imported.specifier)
    // Resolve exactly one conventional local JSX module; ambiguous candidates are unsupported.
    const options = [base, base+'.tsx', base+'.jsx',resolve(base,'index.tsx'),resolve(base,'index.jsx')]
    const paths = options.filter(path => { try { checkedSource(root, relative(root,path)); return true } catch { return false } })
    return paths.length === 1 && relative(root,paths[0]) === proof.file && use.imported.exported === proof.owner &&
      use.prop === proof.prop && use.field === proof.field && use.collection === proof.collection && useIdentity(proof.caller, proof.file, code, use, ownerCode, host.root) === proof.id
  })
  if (matches.length !== 1) throw Error('The selected render site or record expression changed.')
  return { use: matches[0], host, tree, code, ownerCode }
}
