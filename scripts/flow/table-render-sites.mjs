import { createHash } from 'node:crypto'
import { relative, isAbsolute } from 'node:path'
import { parse } from '@babel/parser'
import MagicString from 'magic-string'

const marker = 'data-inspector-template'
const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 32)
const functions = new Set(['ArrowFunctionExpression', 'FunctionExpression', 'FunctionDeclaration', 'ObjectMethod'])
const keyOf = property => property.computed ? undefined : property.key?.name ?? property.key?.value

// A column definition with an explicit accessor and cell renderer identifies a
// render site even when the table library, rather than the app, creates the <td>.
function columnRenderer(node, property, object) {
  return functions.has(node.type) && property?.type === 'ObjectProperty' && property.value === node &&
    keyOf(property) === 'cell' && object?.type === 'ObjectExpression' &&
    object.properties.some(sibling => ['accessorKey', 'accessorFn'].includes(keyOf(sibling)))
}

export function tableRenderSites(root) {
  return {
    name: 'inspector-table-render-sites',
    enforce: 'pre',
    transform(code, id) {
      const file = relative(root, id)
      if (!/\.[jt]sx$/.test(file) || file.startsWith('..') || isAbsolute(file) || file.split(/[\\/]/).includes('node_modules')) return
      if (!/<(?:td|th|tr)\b|\b(?:cell|gridcell|row)\b/.test(code)) return
      let tree
      try {
        tree = parse(code, { sourceType: 'unambiguous', plugins: ['jsx', 'typescript', 'decorators-legacy'] })
      } catch {
        // Let the project's own JSX pipeline handle syntax outside this adapter.
        return
      }
      const output = new MagicString(code)
      // Changing this source file invalidates its automatic markers rather than
      // silently assigning a previous edit to a replacement at the same offset.
      const revision = digest(file + '\0' + code)
      function visit(node, inCell, parent, grandparent) {
        if (!node?.type) return
        if (functions.has(node.type)) inCell = columnRenderer(node, parent, grandparent)
        if (node.type === 'JSXElement') {
          const { name, attributes } = node.openingElement
          const tag = name.type === 'JSXIdentifier' ? name.name : ''
          const role = attributes.find(attr => attr.name?.name === 'role')?.value?.value
          inCell ||= ['td', 'th', 'tr'].includes(tag) || ['cell', 'gridcell', 'columnheader', 'row'].includes(role)
          const suppliedByCaller = attributes.some(attr => attr.type === 'JSXSpreadAttribute' ||
            attr.name?.name === marker || (['style', 'className', 'class'].includes(attr.name?.name) &&
              attr.value?.type === 'JSXExpressionContainer'))
          if (inCell && /^[a-z][a-z0-9]*$/.test(tag) && !suppliedByCaller) {
            output.appendLeft(name.end, ' ' + marker + '="jsx-site/' + revision + '/' + name.start + '"')
          }
        }
        for (const child of Object.values(node)) {
          if (Array.isArray(child)) for (const item of child) visit(item, inCell, node, parent)
          else if (child?.type) visit(child, inCell, node, parent)
        }
      }
      visit(tree.program, false)
      if (output.hasChanged()) return { code: output.toString(), map: output.generateMap({ hires: true, source: id }) }
    },
  }
}
