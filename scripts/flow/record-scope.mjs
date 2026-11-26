import {
  walk,
  member,
  identifier,
  componentFunction,
  returnedValue,
  renderedRecord,
  lookupCorroboration,
  backingCollection,
} from './record-render-path.mjs'
import { recordCatalog, recordCatalogRows } from './record-catalog.mjs'
import { onlyElement } from './component-surface.mjs'
import { publicRecordCollection, publicRows } from './public-records.mjs'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import { presentationInput, recordBranches } from './record-presentation.mjs'
import { localBindingNames } from './authored-use.mjs'
import { authoredImports, parseAuthoredJsx } from './authored-forwarding.mjs'

const digest = (value) => createHash('sha256').update(value).digest('hex').slice(0, 24)
const markerProp = '__inspectorRecordScope'
const scalar = /^[^\x00-\x1F\x7F]{1,70}$/u
const names = /^[A-Za-z_$][\w$]*$/
function mappedUses(tree, allowPublic, catalog) {
  const imports = authoredImports(tree)
  const locals = localBindingNames(tree)
  const uses = []
  walk(tree.program, (node, scope) => {
    if (node.type !== 'CallExpression' || !member(node.callee, 'map') || !identifier(node.callee.object)) return
    const [fn] = node.arguments
    if (
      node.arguments.length !== 1 ||
      fn?.type !== 'ArrowFunctionExpression' ||
      fn.params.length !== 1 ||
      !identifier(fn.params[0]) ||
      returnedValue(fn)?.type !== 'JSXElement'
    )
      return
    const opening = returnedValue(fn).openingElement
    const name = opening.name.name
    const local = (allowPublic || catalog) && scope && name && componentFunction(tree, name, true) &&
      !localBindingNames({ program: scope }).has(name) && { local: true, exported: name }
    const imported = local || imports.get(name)
    if (
      !imported ||
      (!local && (locals.has(name) || !imported.specifier.startsWith('.'))) ||
      opening.attributes.some((a) => a.type === 'JSXSpreadAttribute' || a.name?.name === markerProp)
    )
      return
    const item = fn.params[0].name
    const key = opening.attributes.find((a) => a.name.name === 'key')?.value?.expression
    if (!member(key) || !identifier(key.object, item)) return
    const field = key.property.name
    const records = opening.attributes.filter(
      (a) => a.name.name !== 'key' && identifier(a.value?.expression, item),
    )
    if (records.length !== 1) return
    // A separate application membership lookup must consume the same identity.
    const corroborated = opening.attributes.some((a) => {
      const expr = a.value?.expression
      return (
        expr?.type === 'CallExpression' &&
        member(expr.callee, 'includes') &&
        identifier(expr.callee.object) &&
        expr.arguments.length === 1 &&
        member(expr.arguments[0], field) &&
        identifier(expr.arguments[0].object, item)
      )
    })
    const proof = !corroborated && lookupCorroboration(tree, scope, fn, opening, item, field, locals)
    const backing = backingCollection(scope, node.callee.object.name)
    const authority = allowPublic && (!backing || !(corroborated || proof)) && publicRecordCollection(tree, scope, node.callee.object.name, locals)
    const structural = catalog && backing && !authority && !(corroborated || proof)
    if ((backing && (corroborated || proof)) || authority || structural)
      uses.push({
        proof: authority ? authority.spans : [...(proof || []), ...(backing.source ? [backing.source] : [])],
        resource: authority?.url,
        catalog: structural ? catalog : undefined,
        backing: authority?.name ?? backing.name,
        fn,
        opening,
        imported,
        item,
        field,
        collection: node.callee.object.name,
        prop: records[0].name.name,
      })
  })
  return uses
}

function componentRoot(tree, exported, prop, local = false) {
  const fn = componentFunction(tree, exported, local)
  const params = fn?.params[0]
  if (
    params?.type !== 'ObjectPattern' ||
    fn.params.length !== 1 ||
    params.properties.some((p) => p.type !== 'ObjectProperty' || p.computed || p.key.name === markerProp)
  )
    return
  const record = params.properties.find((p) => p.key.name === prop && identifier(p.value))?.value.name
  if (!record) return
  const returned = returnedValue(fn)
  const jsx = returned?.type === 'JSXFragment' ? onlyElement(returned.children) : returned
  if (jsx?.type !== 'JSXElement') return
  const root = jsx.openingElement
  if (
    !/^[a-z][a-z0-9]*$/.test(root.name.name ?? '') ||
    root.attributes.some(
      (a) =>
        a.type === 'JSXSpreadAttribute' ||
        ['data-inspector-target', 'data-li-record-scope'].includes(a.name?.name),
    )
  )
    return
  const presentation = presentationInput(root, params)
  if (renderedRecord(fn, record, jsx) && presentation) return { root, fn, params, presentation }
}

function checkedSource(root, file) {
  if (
    !/^(?!.*(?:^|\/)\.\.(?:\/|$))[\w./-]+\.[jt]sx$/.test(file) ||
    file.startsWith('/') ||
    file.split('/').includes('node_modules')
  )
    throw Error('Unverified record source.')
  const path = resolve(root, file)
  if (relative(root, path) !== file || realpathSync(path) !== path) throw Error('Unverified record source.')
  return readFileSync(path, 'utf8')
}

function useIdentity(caller, file, code, use, ownerSource, root) {
  return digest(
    JSON.stringify([
      caller,
      file,
      use.imported,
      use.collection,
      use.prop,
      code.slice(use.opening.start, use.opening.end),
      ownerSource.slice(root.start, root.end),
      ...(use.catalog ? [[use.catalog.file,use.catalog.importer,use.catalog.specifier,use.catalog.binding]] : []),
      ...(use.proof ? use.proof.map((span) => code.slice(span.start, span.end)) : []),
    ]),
  )
}

// Source-derived identity is a hint for selection; source handoff rechecks it independently.
export async function markRecordCallers({ root, file, code, tree, out, resolveImport, allowPublic = false, catalog, watchFile }) {
  if (code.includes('__liRecordIdentity') || code.includes('__liScope') || code.includes('__liRecordRows')) return false
  const candidates = []
  for (const use of mappedUses(tree, allowPublic, catalog)) {
    const resolved = use.imported.local ? resolve(root,file) : await resolveImport(use.imported.specifier)
    if (!resolved) continue
    const ownerFile = relative(root, resolved)
    let ownerCode, host
    try {
      ownerCode = checkedSource(root, ownerFile)
      host = componentRoot(parseAuthoredJsx(ownerCode), use.imported.exported, use.prop, use.imported.local)
    } catch {
      continue
    }
    if (!host || (host.presentation.assisted && !use.catalog) || !recordBranches(use, host.presentation.prop)) continue
    const id = useIdentity(file, ownerFile, code, use, ownerCode, host.root)
    const dataset = use.catalog ? recordCatalogRows(root,use.catalog,use.field,watchFile) :
      use.resource && publicRows(root,use.resource,use.field,watchFile)
    if ((use.resource || use.catalog) && !dataset) continue
    candidates.push({ use, ownerFile, id, dataset })
  }
  let marked = false
  for (const { use, ownerFile, id, dataset } of candidates) {
    if (candidates.filter((c) => c.id === id).length !== 1) continue
    const table = '__liRecordRows' + id
    if (dataset) out.prepend('const ' + table + ' = ' + JSON.stringify(dataset.entries) + ';\n')
    const proof = JSON.stringify({
      id,
      caller: file,
      ...(use.resource ? {resource:use.resource} : {}),
      ...(use.catalog ? {catalog:use.catalog} : {}),
      file: ownerFile,
      owner: use.imported.exported,
      prop: use.prop,
      field: use.field,
      collection: use.collection,
      ...(use.backing !== use.collection ? { backing: use.backing } : {}),
    })
    out.appendLeft(
      use.fn.start,
      '__liRecordIdentity(' +
        proof +
        ', ' +
        use.collection +
        ', ' +
        JSON.stringify(use.field) +
        ', __liScope => (',
    )
    out.appendLeft(use.fn.end, use.backing === use.collection && !dataset ? '))' : '), ' + use.backing + (dataset ? ', ' + table : '') + ')')
    out.appendLeft(use.opening.name.end, ' ' + markerProp + '={__liScope(' + use.item + ')}')
    marked = true
  }
  if (marked)
    out.prepend('import { recordIdentity as __liRecordIdentity } from "virtual:inspector-prepared-registry";\n')
  return marked
}

export function markRecordHost(tree, node, owner, file, out, requireInput = false) {
  const props = componentFunction(tree, owner.id?.name, true)?.params?.[0]
  if (props?.type !== 'ObjectPattern') return
  for (const p of props.properties) {
    const host = p.key && componentRoot(tree, owner.id.name, p.key.name, true)
    if (host?.root !== node || (requireInput && !host.presentation.prop && !host.presentation.assisted)) continue
    const proof = '__liRecordProof'
    out.appendLeft(props.start + 1, markerProp + ': ' + proof + ', ')
    out.appendLeft(
      node.name.end,
      ' {...__liRecordAttrs(' + proof + ', ' + JSON.stringify(file) + ', ' + JSON.stringify(owner.id.name) + ')}',
    )
    return true
  }
}

export function verifyRecordSource(root, proof, catalog) {
  if (
    !proof ||
    !scalar.test(proof.value) ||
    !String(proof.value).trim() ||
    !(typeof proof.value === 'string' || ((proof.resource || proof.catalog) && Number.isSafeInteger(proof.value))) ||
    !/^[a-f0-9]{24}$/.test(proof.id) ||
    !names.test(proof.owner) ||
    !names.test(proof.prop) ||
    proof.key !== 'record:' + proof.id + ':' + ((proof.resource || proof.catalog) ? proof.rowRevision : proof.value)
  )
    throw Error('Invalid record identity.')
  if (proof.catalog && (!catalog || JSON.stringify(proof.catalog) !== JSON.stringify(catalog) ||
      JSON.stringify(recordCatalog(root,[catalog])) !== JSON.stringify(catalog)))
    throw Error('The application data source no longer resolves uniquely.')
  const code = checkedSource(root, proof.caller),
    ownerCode = checkedSource(root, proof.file)
  const tree = parseAuthoredJsx(ownerCode)
  const host = componentRoot(tree, proof.owner, proof.prop, proof.caller === proof.file)
  if (!host) throw Error('The selected component no longer has a unique native root.')
  const matches = mappedUses(parseAuthoredJsx(code), Boolean(proof.resource) || proof.caller === proof.file, proof.catalog && catalog).filter((use) => {
    const base = use.imported.local ? resolve(root,proof.caller) : resolve(root, proof.caller, '..', use.imported.specifier)
    // Resolve exactly one conventional local JSX module; ambiguous candidates are unsupported.
    const options = [base, base + '.tsx', base + '.jsx', resolve(base, 'index.tsx'), resolve(base, 'index.jsx')]
    const paths = options.filter((path) => {
      try {
        checkedSource(root, relative(root, path))
        return true
      } catch {
        return false
      }
    })
    return (
      use.resource === proof.resource && JSON.stringify(use.catalog) === JSON.stringify(proof.catalog) &&
      (!host.presentation.assisted || use.catalog) &&
      (!use.catalog || recordCatalogRows(root,use.catalog,use.field)?.entries.some(entry=>entry.value === proof.value && entry.revision === proof.rowRevision)) &&
      (!use.resource || publicRows(root,use.resource,use.field)?.entries.some(entry => entry.value === proof.value && entry.revision === proof.rowRevision)) &&
      paths.length === 1 &&
      relative(root, paths[0]) === proof.file &&
      use.imported.exported === proof.owner &&
      use.prop === proof.prop &&
      use.field === proof.field &&
      use.collection === proof.collection &&
      use.backing === (proof.backing ?? proof.collection) &&
      recordBranches(use, host.presentation.prop) &&
      useIdentity(proof.caller, proof.file, code, use, ownerCode, host.root) === proof.id
    )
  })
  if (matches.length !== 1) throw Error('The selected render site or record expression changed.')
  return { use: matches[0], host, tree, code, ownerCode }
}
