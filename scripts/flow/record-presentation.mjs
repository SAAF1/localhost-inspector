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
  if (styles.length !== 1 || object?.type !== 'ObjectExpression') return
  const disjoint = object.properties.every(p=>p.type === 'ObjectProperty' && !p.computed &&
    p.key.type === 'Identifier' && !/^(?:all|cssText)$|radius/i.test(p.key.name))
  if (disjoint) return {prop:null, assisted:true}
  if (object.properties.length !== 1) return
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

function countGuard(right, collection, field, value) {
  if (!equal(right) || right.right.type !== 'NumericLiteral' || right.right.value !== 1) return false
  const length = right.left,
    filter = length?.object
  if (
    length?.type !== 'MemberExpression' ||
    length.computed ||
    !id(length.property, 'length') ||
    filter?.type !== 'CallExpression' ||
    !member(filter.callee, collection, 'filter') ||
    filter.arguments.length !== 1
  )
    return false
  const [callback] = filter.arguments
  const cond = callback.body
  return (
    callback.type === 'ArrowFunctionExpression' &&
    callback.params.length === 1 &&
    callback.params[0].type === 'Identifier' &&
    equal(cond) &&
    member(cond.left, callback.params[0].name, field) &&
    cond.right.type === 'StringLiteral' &&
    cond.right.value === value
  )
}
const conjunction = (node) => node?.type === 'LogicalExpression' && node.operator === '&&'
function recordGuard(test, use) {
  if (!conjunction(test)) return
  const derived = use.backing !== use.collection
  const base = derived ? test.left : test
  if (!conjunction(base)) return
  const { left, right } = base
  if (!equal(left) || !member(left.left, use.item, use.field) || left.right.type !== 'StringLiteral') return
  const value = left.right.value
  if (!countGuard(right, use.collection, use.field, value)) return
  if (derived) {
    const extra = test.right,
      membership = extra?.left
    if (
      !conjunction(extra) ||
      membership?.type !== 'CallExpression' ||
      !member(membership.callee, use.backing, 'includes') ||
      membership.arguments.length !== 1 ||
      !id(membership.arguments[0], use.item) ||
      !countGuard(extra.right, use.backing, use.field, value)
    )
      return
  }
  return value
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
