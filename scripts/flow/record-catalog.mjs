// A proposal comes from Vite's resolved import graph. The importer must
// actually execute before any row can acquire this source authority.
import { readFileSync, realpathSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { parseAuthoredJsx } from './authored-forwarding.mjs'
import { localBindingNames } from './authored-use.mjs'
import { syntaxFingerprint } from './component-proof.mjs'
import { recordRows } from './public-records.mjs'

export function recordCatalog(root, edges) {
  if (edges.length !== 1) return
  const [{importer,specifier,file}] = edges
  if (!/^[\w./-]+\.[jt]sx$/.test(importer) || !/^[\w./-]+\.json$/.test(file) ||
      !specifier.startsWith('.') || [file,importer].some(path => path.startsWith('/') ||
        path.split('/').some(part=>['..','node_modules','.git'].includes(part)))) return
  const path = join(root,importer)
  try {
    if (realpathSync(path) !== path || relative(root,resolve(dirname(path),specifier)) !== file) return
    const tree = parseAuthoredJsx(readFileSync(path,'utf8'))
    const bindings = tree.program.body.filter(s=>s.type === 'ImportDeclaration' && s.source.value === specifier &&
      s.importKind !== 'type').flatMap(s=>s.specifiers).filter(s=>s.type === 'ImportDefaultSpecifier')
    if (bindings.length !== 1) return
    const binding = bindings[0].local.name
    if (localBindingNames(tree).has(binding) || !catalogExpressions(tree,binding).reads.length) return
    return {file,importer,specifier,binding,importerRevision:syntaxFingerprint(tree.program)}
  } catch { /* An optional data contract must not break the ordinary app. */ }
}
export function recordCatalogRows(root, catalog, field, watchFile) {
  const data = recordRows(join(root,catalog.file),field,watchFile)
  return data?.entries.every(entry => Object.entries(JSON.parse(entry.json)).some(([key,value])=>
    key !== field && ['string','number'].includes(typeof value))) ? data : undefined
}

function catalogExpressions(tree,binding) {
  const reads = [], copies = []
  function visit(node,parent) {
    if (!node?.type) return
    if (node.type === 'Identifier' && node.name === binding && (
      parent?.type === 'CallExpression' && parent.arguments.includes(node) ||
      parent?.type === 'VariableDeclarator' && parent.init === node ||
      parent?.type === 'MemberExpression' && parent.object === node ||
      parent?.type === 'ReturnStatement' && parent.argument === node)) reads.push(node)
    if (node.type === 'ObjectExpression' && node.properties[0]?.type === 'SpreadElement' &&
        node.properties[0].argument.type === 'Identifier' &&
        node.properties.filter(p=>p.type === 'SpreadElement').length === 1) copies.push(node)
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) for (const child of value) visit(child,node)
      else if (value?.type) visit(value,node)
    }
  }
  visit(tree.program)
  return {reads,copies}
}

export function registerCatalogImport(out,file,catalog,tree) {
  if (file !== catalog?.importer || syntaxFingerprint(tree.program) !== catalog.importerRevision) return false
  const {reads,copies} = catalogExpressions(tree,catalog.binding)
  if (!reads.length) return false
  out.prepend('import { registerRecordCatalog as __liRegisterCatalog, derivedRecord as __liDerivedRecord } from "virtual:inspector-prepared-registry";\n')
  for (const ref of reads) {
    out.prependLeft(ref.start,'__liRegisterCatalog('+JSON.stringify(catalog)+',')
    out.appendRight(ref.end,',import.meta.hot)')
  }
  // Preserve the actual input object before evaluating the remaining fields.
  // Associate the newly created application object without modifying it.
  for (const copy of copies) {
    out.prependLeft(copy.start,'__liDerivedRecord('+copy.properties[0].argument.name+',')
    out.appendRight(copy.end,')')
  }
  return true
}
