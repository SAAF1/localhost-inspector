// Recognize the existing frontend input by the CSS property it owns. The prop
// name and callback variable are allowed to differ between components.
export const fixedRadius = (value) => typeof value === 'string' && /^\d+(?:\.\d+)?px$/.test(value)
const id = (node, name) => node?.type === 'Identifier' && node.name === name
const member = (node, object, property) =>
  node?.type === 'MemberExpression' && !node.computed && id(node.object, object) && id(node.property, property)
const equal = (node) => node?.type === 'BinaryExpression' && node.operator === '==='

export function presentationInput(root, params) {
  const styles = root.attributes.filter((a) => a.name?.name === 'style')
  if (!styles.length) return { prop: null }
  const object = styles[0].value?.expression
  if (styles.length !== 1 || object?.type !== 'ObjectExpression' || object.properties.length !== 1) return
  const [declaration] = object.properties
  if (
    declaration.type !== 'ObjectProperty' ||
    declaration.computed ||
    !id(declaration.key, 'borderRadius') ||
    declaration.value.type !== 'Identifier'
  )
    return
  const param = params.properties.find((p) => id(p.value, declaration.value.name))
  if (param?.key.type === 'Identifier') return { prop: param.key.name }
}

function recordGuard(test, use) {
  if (test?.type !== 'LogicalExpression' || test.operator !== '&&') return
  const { left, right } = test
  if (
    !equal(left) ||
    !member(left.left, use.item, use.field) ||
    left.right.type !== 'StringLiteral' ||
    !equal(right) ||
    right.right.type !== 'NumericLiteral' ||
    right.right.value !== 1
  )
    return
  const length = right.left
  const filter = length?.object
  if (
    length?.type !== 'MemberExpression' ||
    length.computed ||
    !id(length.property, 'length') ||
    filter?.type !== 'CallExpression' ||
    !member(filter.callee, use.collection, 'filter') ||
    filter.arguments.length !== 1
  )
    return
  const callback = filter.arguments[0]
  const condition = callback.body
  if (
    callback.type !== 'ArrowFunctionExpression' ||
    callback.params.length !== 1 ||
    callback.params[0].type !== 'Identifier' ||
    !equal(condition) ||
    !member(condition.left, callback.params[0].name, use.field) ||
    condition.right.type !== 'StringLiteral' ||
    condition.right.value !== left.right.value
  )
    return
  return left.right.value
}

export function recordBranches(use, prop) {
  if (!prop) return { cases: new Map() }
  const attrs = use.opening.attributes.filter((a) => a.name?.name === prop)
  if (!attrs.length) return { cases: new Map() }
  if (attrs.length !== 1 || attrs[0].value?.type !== 'JSXExpressionContainer') return
  let expr = attrs[0].value.expression
  const cases = new Map()
  while (expr.type === 'ConditionalExpression') {
    const value = recordGuard(expr.test, use)
    if (
      !value ||
      cases.has(value) ||
      expr.consequent.type !== 'StringLiteral' ||
      !fixedRadius(expr.consequent.value)
    )
      return
    cases.set(value, expr.consequent)
    expr = expr.alternate
  }
  if (id(expr, 'undefined')) return { cases, tail: expr }
}
