// The audit reads exported design values. Registration remains authoritative for editing.
import { opendir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

const fields = ['font-family', 'font-weight', 'font-size', 'line-height', 'letter-spacing']
const ignored = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'vendor', 'storybook-static'])

async function* styleSheets(root, directory = root) {
  for await (const item of await opendir(directory)) {
    if (item.name.startsWith('.') || ignored.has(item.name)) continue
    const path = join(directory, item.name)
    if (item.isDirectory()) yield* styleSheets(root, path)
    if (item.isFile() && item.name.endsWith('.css') && (await stat(path)).size <= 1024 * 1024) {
      yield { source: relative(root, path), css: await readFile(path, 'utf8') }
    }
  }
}

export function declaredVariables(css) {
  const colors = new Set(), spacing = new Set(), styles = new Set()
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '')
  // Inspect flat declaration lists on a public root or a theme export. Component-local
  // properties can legitimately look like design tokens without being part of the system.
  const blocks = [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(([, selector]) =>
    selector.split(',').some(part => /^:root$|^@theme(?:\s+[\w-]+)*$/.test(part.trim())))
  const rootNames = new Set()
  for (const [, , body] of blocks) {
    for (const match of body.matchAll(/(?:^|;)\s*(--[\w-]+)\s*:/g)) rootNames.add(match[1])
  }
  for (const [, selector, body] of blocks) {
    for (const [, name, value] of body.matchAll(/(?:^|;)\s*(--[\w-]+)\s*:\s*([^;{}]+)/g)) {
      if (/^--color-/.test(name)) {
        const alias = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value.trim())?.[1]
        // Inline theme aliases need not survive the build. The underlying role does.
        colors.add(selector.trim().startsWith('@theme') && alias && rootNames.has(alias) ? alias : name)
      }
      if (/^--(?:space|spacing)-/.test(name)) spacing.add(name)
      if (name.endsWith('-font-family')) {
        const prefix = name.slice(0, -'-font-family'.length)
        if (fields.every(field => rootNames.has(prefix + '-' + field))) styles.add(prefix)
      }
    }
  }
  return { colorCatalog: [...colors], spacingCatalog: [...spacing], textStyleCatalog: [...styles] }
}

export async function discoverVariablesCatalog(root, registered = {}) {
  const kinds = ['colorCatalog', 'spacingCatalog', 'textStyleCatalog']
  const found = Object.fromEntries(kinds.map(kind => [kind, new Set(registered[kind]?.names)]))
  const sources = Object.fromEntries(kinds.map(kind => [kind, new Set()]))
  const known = new Map(Object.values(registered).filter(Boolean).map(file => [file.source, file]))
  const files = known.size ? known.values() : styleSheets(root)
  for await (const { source, css } of files) {
    const declared = declaredVariables(css)
    for (const kind of kinds) {
      if (registered[kind] && registered[kind].source !== source) continue
      if (declared[kind].length) sources[kind].add(source)
      for (const name of declared[kind]) found[kind].add(name)
    }
  }
  return Object.fromEntries(kinds.map(kind => [kind, {
    source: registered[kind]?.source ?? (sources[kind].size === 1 ? [...sources[kind]][0] : null),
    names: [...found[kind]].sort(),
  }]))
}
