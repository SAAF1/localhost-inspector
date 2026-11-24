import { readFile, realpath, stat } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { discoverVariablesCatalog } from '../../variables-catalog.mjs'
import { declaresVariable, textStyleProperties, variableName } from '../../journal-values.mjs'

async function optional(file) {
  try { return JSON.parse(await readFile(file, 'utf8')) } catch (error) { if (error.code !== 'ENOENT') throw error }
}

export function variantCatalogs(directory, { canvas = dirname(dirname(directory)), sourceRoot } = {}) {
  async function source() {
    if (sourceRoot) return sourceRoot
    const ref = await optional(join(directory, 'source.json'))
    if (!ref) return
    let path = resolve(canvas, ref.path)
    if (await optional(join(path, 'proposal.json')).catch(e => { if (e.code !== 'ENOTDIR') throw e })) path = join(path, 'app')
    return (await stat(path).catch(() => null))?.isDirectory() ? await realpath(path) : null
  }
  async function catalog(kind) {
    const registry = (await optional(join(canvas, 'inspector-state.json')))?.registrations
    const item = registry?.[kind]
    if (!item || typeof item.source !== 'string' || !item.source.endsWith('.css') ||
        !Array.isArray(item.names) || !item.names.every(name => variableName.test(name))) return null
    const root = await source()
    if (!root) return null
    const path = await realpath(resolve(root, item.source)).catch(() => null)
    if (!path?.startsWith(root + sep) || (await stat(path)).size > 1024 * 1024) return null
    const css = (await readFile(path, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '')
    const names = item.names.filter(name => kind === 'text-styles'
      ? textStyleProperties.every(prop => declaresVariable(css, name + '-' + prop)) : declaresVariable(css, name))
    return { source: item.source, names, css, file: path }
  }
  return {
    read: catalog,
    // Registered button-size is tied to a particular source instrumented target.
    button: () => null,
    async get(type) {
      const kinds = { fontFamilyCatalog: 'font-families', colorCatalog: 'colors', spacingCatalog: 'spacing', textStyleCatalog: 'text-styles' }
      if (type === 'variablesCatalog') {
        const root = await source()
        return root ? discoverVariablesCatalog(root, { colorCatalog: await catalog('colors'),
          spacingCatalog: await catalog('spacing'), textStyleCatalog: await catalog('text-styles') }) : {}
      }
      if (!Object.hasOwn(kinds, type)) throw Error('Unknown catalog')
      const item = await catalog(kinds[type])
      if (type === 'fontFamilyCatalog') return (item?.names ?? []).map(name => ({ name }))
      if (!item) return null
      return { source: item.source, names: item.names, canCreate: false, canCreateDefinition: false }
    },
  }
}
