// Follow literal frontend imports using the installed application's Vite resolver.
import { realpathSync, readFileSync } from 'node:fs'
import { classJoinPackages, resolvedClassJoin, resolvedPackageEntry } from './class-composition.mjs'
import { projectVite } from './project-vite.mjs'
import { join, relative } from 'node:path'
import { parse } from '@babel/parser'
import { cssParser } from './prepared-css.mjs'

function scriptImports(source) {
  const imports = []
  const ast = parse(source, { sourceType: 'unambiguous', plugins: ['typescript', 'jsx', 'decorators-legacy'] })
  function visit(n) {
    if (!n?.type) return
    if (n.source && ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(n.type)) {
      if (n.importKind !== 'type' && n.exportKind !== 'type') imports.push({ id: n.source.value })
    }
    if (n.type === 'CallExpression' && n.callee.type === 'Import')
      imports.push({ id: n.arguments[0]?.value, lazy: true })
    for (const value of Object.values(n)) {
      if (Array.isArray(value)) value.forEach(visit)
      else if (value?.type) visit(value)
    }
  }
  visit(ast.program)
  return imports
}
export async function stylesheetGraph(root, running, onProjectImport, onClassJoin, onMotion) {
  if (!running && realpathSync(process.cwd()) !== realpathSync(root)) {
    const { discoverProjectStyles } = await import('./project-stylesheet-graph.mjs')
    return discoverProjectStyles(root,onProjectImport,onClassJoin,onMotion)
  }
  const { createServer } = await projectVite(root)
  const server =
    running ??
    (await createServer({
      server: { middlewareMode: true, hmr: false, watch: null, open: false },
      optimizeDeps: { noDiscovery: true, include: [] },
      logLevel: 'silent',
    }))
  const sheets = new Map(),
    visited = new Set(),
    unresolved = new Set(),
    utilityEntries = new Set()
  const css = cssParser(root)
  const container = server.environments?.client.pluginContainer ?? server.pluginContainer
  const resolveCSS = server.config.createResolver({
    extensions: ['.css'],
    mainFields: ['style'],
    conditions: ['style', 'development'],
    preferRelative: true,
    tryIndex: false,
  })
  async function follow(id, importer, lazy, served) {
    if (typeof id !== 'string' || id.includes('?')) {
      unresolved.add(relative(root, importer) + ' ' + (id ?? 'dynamic import'))
      return
    }
    const resolved = served ? await resolveCSS(id, importer) : (await container.resolveId(id, importer))?.id
    if (!resolved) {
      unresolved.add(relative(root, importer) + ' ' + id)
      return
    }
    if (!served && onClassJoin && classJoinPackages.has(id) && await resolvedClassJoin(container, id, importer))
      onClassJoin(relative(root, importer), id)
    if (!served && onMotion && id === 'framer-motion' && await resolvedPackageEntry(container,id,importer,12))
      onMotion(relative(root, importer), id)
    if (!resolved.startsWith(root + '/') || resolved.includes('/node_modules/')) return
    const file = relative(root, resolved)
    if (!served) onProjectImport?.(relative(root, importer), id, file)
    if (/\.css$/.test(file)) {
      const entry = served ?? file
      const key = JSON.stringify([file, entry, lazy])
      if (visited.has(key)) return
      visited.add(key)
      const sheet = sheets.get(file) ?? { file, served: [], lazy: true }
      if (!sheet.served.includes(entry)) sheet.served.push(entry)
      if (!lazy) sheet.lazy = false
      sheets.set(file, sheet)
      const parsed = css.parse(readFileSync(resolved, 'utf8'), { from: resolved })
      for (const node of parsed.nodes) {
        if (node.type !== 'atrule' || node.name !== 'import') continue
        const path = /^(?:url\(\s*)?["']([^"']+)["']/.exec(node.params)?.[1]
        if (path === 'tailwindcss') utilityEntries.add(entry)
        else await follow(path, resolved, lazy, entry)
      }
    } else if (/\.[cm]?[jt]sx?$/.test(file)) {
      const key = JSON.stringify([file, lazy])
      if (visited.has(key)) return
      visited.add(key)
      let imports
      try {
        imports = scriptImports(readFileSync(resolved, 'utf8'))
      } catch {
        unresolved.add(file)
        return
      }
      for (const dep of imports) await follow(dep.id, resolved, lazy || Boolean(dep.lazy))
    }
  }
  try {
    const entry = join(realpathSync(server.config.root),'index.html')
    if (!entry.startsWith(root + '/')) throw Error('Configured Vite HTML root is outside the candidate project.')
    const html = readFileSync(entry, 'utf8')
    for (const link of html.matchAll(/<link\b[^>]*>/gi)) {
      if (/\brel\s*=\s*["']stylesheet["']/i.test(link[0])) unresolved.add('HTML stylesheet ' + link[0])
    }
    for (const tag of html.matchAll(/<script\b[^>]*>/gi)) {
      if (!/\btype\s*=\s*["']module["']/i.test(tag[0])) continue
      const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag[0])?.[1]
      if (src) await follow(src, entry, false)
      else unresolved.add('inline HTML module')
    }
    const configuration = server.config.configFileDependencies
      .filter((p) => p.startsWith(root + '/') && !p.includes('/node_modules/'))
      .map((p) => relative(root, p))
    return {
      entry:relative(root,entry),
      configuration,
      sheets: [...sheets.values()],
      utilityEntries: [...utilityEntries],
      unresolved: [...unresolved],
    }
  } finally {
    if (!running) await server.close()
  }
}
