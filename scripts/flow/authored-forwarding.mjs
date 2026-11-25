import { parse } from '@babel/parser'

export const parseAuthoredJsx = (code) =>
  parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] })

export function authoredImports(tree) {
  const imports = new Map()
  for (const entry of tree.program.body) {
    if (entry.type !== 'ImportDeclaration' || entry.importKind === 'type') continue
    for (const specifier of entry.specifiers) {
      if (specifier.type !== 'ImportSpecifier' || specifier.importKind === 'type') continue
      const exported = specifier.imported.name
      if (exported) imports.set(specifier.local.name, { exported, specifier: entry.source.value })
    }
  }
  return imports
}

// Qualify only a direct, unconditional native return that forwards remaining
// props. Rest must carry both style and the dev-only provenance attribute.
export function forwardedHost(code, exported, { requireChildren = false } = {}) {
  const { body } = parseAuthoredJsx(code).program
  const declaration = body.find(
    (entry) => entry.type === 'ExportNamedDeclaration' && entry.declaration?.id?.name === exported,
  )?.declaration
  const alias = body
    .filter((entry) => entry.type === 'ExportNamedDeclaration' && !entry.source)
    .flatMap((entry) => entry.specifiers)
    .find((specifier) => specifier.exported.name === exported)?.local.name
  const fn =
    declaration ?? body.find((entry) => entry.type === 'FunctionDeclaration' && entry.id?.name === alias)
  if (fn?.type !== 'FunctionDeclaration' || fn.params.length !== 1 || fn.body.body.length !== 1) return
  const props = fn.params[0]
  if (props.type !== 'ObjectPattern') return
  const rest = props.properties.at(-1)
  if (rest?.type !== 'RestElement' || rest.argument.type !== 'Identifier') return
  let childParameter
  for (const key of props.properties.slice(0, -1)) {
    if (key.type !== 'ObjectProperty' || key.computed || key.key.type !== 'Identifier') return
    if (['style', 'data-li-authored-use'].includes(key.key.name)) return
    if (key.key.name === 'children') childParameter = key.value
  }
  const statement = fn.body.body[0]
  const root = statement.type === 'ReturnStatement' && statement.argument
  const opening = root?.type === 'JSXElement' && root.openingElement
  const tag = opening?.name.name
  if (!opening || !/^[a-z][a-z0-9]*$/.test(tag ?? '')) return
  const spreads = opening.attributes.filter((attr) => attr.type === 'JSXSpreadAttribute')
  if (
    spreads.length !== 1 ||
    spreads[0].argument.type !== 'Identifier' ||
    spreads[0].argument.name !== rest.argument.name ||
    opening.attributes.some((attr) => ['style', 'data-li-authored-use'].includes(attr.name?.name))
  )
    return
  if (requireChildren) {
    if (opening.attributes.some((attr) => ['children', 'dangerouslySetInnerHTML'].includes(attr.name?.name)))
      return
    const children = root.children.filter((child) => child.type !== 'JSXText' || child.value.trim())
    if (childParameter) {
      if (
        childParameter.type !== 'Identifier' ||
        children.length !== 1 ||
        children[0].type !== 'JSXExpressionContainer' ||
        children[0].expression.type !== 'Identifier' ||
        children[0].expression.name !== childParameter.name
      )
        return
    } else if (children.length) return
  }
  return tag
}
