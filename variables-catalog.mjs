// The audit reads exported design values. Registration remains authoritative for editing.
import { opendir, readFile, stat } from 'node:fs/promises'
import { declaresVariable, variableName } from './journal-values.mjs'
import { discoverComponentCatalog } from './component-catalog.mjs'
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

// Supply the exact CSS names the project already exports at authoring time.
export async function authoringStyles(root, registrations = {}) {
  const typography = new Map(), spacing = new Map(), colors = new Map(), utilities = new Map()
  for await (const { source, css } of styleSheets(root)) {
    const { colorCatalog, spacingCatalog, textStyleCatalog } = declaredVariables(css)
    for (const [names, target, registration] of [
      [colorCatalog, colors, registrations.colors], [spacingCatalog, spacing, registrations.spacing],
      [textStyleCatalog, typography, registrations['text-styles']],
    ]) {
      if (registration && registration.source !== source) continue
      const available = registration ? registration.names.filter(name => variableName.test(name) &&
        (target === typography ? fields.every(field => declaresVariable(css, name + '-' + field)) : declaresVariable(css, name))) : names
      for (const name of available) if (!target.has(name)) target.set(name, source)
    }
    for (const [, name, body] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/@utility\s+([\w-]+)\s*\{([^{}]*)\}/g)) {
      const declarations = new Map([...body.matchAll(/(?:^|;)\s*([\w-]+)\s*:\s*var\(\s*(--[\w-]+)\s*\)\s*(?=;|$)/g)]
        .map(([, property, variable]) => [property, variable]))
      const family = declarations.get('font-family')
      if (!family?.endsWith('-font-family')) continue
      const token = family.slice(0, -'-font-family'.length)
      if (fields.every(field => declarations.get(field) === token + '-' + field)) utilities.set(token, { className: name, source })
    }
  }
  function byFile(tokens) {
    return [...Map.groupBy(tokens, ([, source]) => source)].map(([source, entries]) => ({ source, tokens: entries.map(([token]) => token).sort() }))
  }
  return {
    typography: [...typography].map(([token, source]) => ({ token, source, utility: utilities.get(token) })),
    spacing: byFile(spacing), colors: byFile(colors),
  }
}

export async function discoverVariablesCatalog(root, registered = {}) {
  const kinds = ['colorCatalog', 'spacingCatalog', 'textStyleCatalog']
  const found = Object.fromEntries(kinds.map(kind => [kind, new Set(registered[kind]?.names)]))
  const sources = Object.fromEntries(kinds.map(kind => [kind, new Set()]))
  const known = new Map(Object.values(registered).filter(Boolean).map(file => [file.source, file]))
  async function* sourceFiles() {
    yield* known.values()
    if (kinds.every(kind => registered[kind])) return
    for await (const sheet of styleSheets(root)) {
      if (!known.has(sheet.source)) yield sheet
    }
  }
  const files = sourceFiles()
  for await (const { source, css } of files) {
    const declared = declaredVariables(css)
    for (const kind of kinds) {
      if (registered[kind] && registered[kind].source !== source) continue
      if (declared[kind].length) sources[kind].add(source)
      for (const name of declared[kind]) found[kind].add(name)
    }
  }
  const catalog = Object.fromEntries(kinds.map(kind => [kind, {
    source: registered[kind]?.source ?? (sources[kind].size === 1 ? [...sources[kind]][0] : null),
    names: [...found[kind]].sort(),
  }]))
  catalog.componentCatalog = await discoverComponentCatalog(root)
  return catalog
}
