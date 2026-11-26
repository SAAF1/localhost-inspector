// A proposal comes from Vite's resolved import graph. The importer must
// actually execute before any row can acquire this source authority.
import { readFileSync, realpathSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { parseAuthoredJsx } from './authored-forwarding.mjs'
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
    if (bindings.length === 1) return {file,importer,specifier,binding:bindings[0].local.name}
  } catch { /* An optional data contract must not break the ordinary app. */ }
}
export function recordCatalogRows(root, catalog, field, watchFile) {
  const data = recordRows(join(root,catalog.file),field,watchFile)
  return data?.entries.every(entry => Object.entries(JSON.parse(entry.json)).some(([key,value])=>
    key !== field && ['string','number'].includes(typeof value))) ? data : undefined
}

export function registerCatalogImport(out,file,catalog) {
  if (file !== catalog?.importer) return false
  out.prepend('import { registerRecordCatalog as __liRegisterCatalog } from "virtual:inspector-prepared-registry";\n')
  out.append('\n__liRegisterCatalog('+JSON.stringify(catalog)+','+catalog.binding+',import.meta.hot);\n')
  return true
}
