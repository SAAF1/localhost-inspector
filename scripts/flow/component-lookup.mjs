// A source example and a project search answer different authoring questions.
// Return evidence for either query without ranking or prescribing a design.
import { readFile, realpath } from 'node:fs/promises'
import { relative, resolve, sep, isAbsolute } from 'node:path'
import { parse } from '@babel/parser'
import { discoverComponentCatalog } from '../../component-catalog.mjs'

export async function lookupComponents(project, mode, value) {
  const root = await realpath(project)
  if (mode === '--find' && value.trim()) {
    const { definitions, skippedFiles } = await discoverComponentCatalog(root, { includeMarkerOnly: true })
    const query = value.trim().toLowerCase()
    return { matches: definitions.filter(({ name }) => name.toLowerCase().includes(query)), skippedFiles }
  }
  if (mode !== '--used-in') throw Error('Use --used-in SOURCE_FILE or --find COMPONENT_NAME')
  const path = await realpath(resolve(root, value))
  const source = relative(root, path)
  if (source === '..' || source.startsWith('..' + sep) || isAbsolute(source)) throw Error('Choose a file in the project')
  const ast = parse(await readFile(path, 'utf8'), { sourceType: 'unambiguous', plugins: ['jsx', 'typescript', 'decorators-legacy'] })
  const imports = new Map()
  for (const statement of ast.program.body) {
    if (statement.type !== 'ImportDeclaration') continue
    for (const spec of statement.specifiers) {
      imports.set(spec.local.name, statement.source.value)
    }
  }
  const used = new Map()
  function visit(node) {
    if (!node?.type) return
    if (node.type === 'JSXOpeningElement') {
      let base = node.name
      const members = []
      while (base.type === 'JSXMemberExpression') {
        members.unshift(base.property.name)
        base = base.object
      }
      if (imports.has(base.name) && (members.length || /^[A-Z]/.test(base.name))) {
        const name = [base.name, ...members].join('.')
        if (!used.has(name)) used.set(name, { name, from: imports.get(base.name), line: node.loc.start.line })
      }
    }
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit)
      else if (child?.type) visit(child)
    }
  }
  visit(ast.program)
  return { source, importedComponentsUsed: [...used.values()] }
}
