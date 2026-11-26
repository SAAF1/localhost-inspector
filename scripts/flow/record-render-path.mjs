import { localBindingNames } from './authored-use.mjs'

export const identifier = (node, name) => node?.type === 'Identifier' && (!name || node.name === name)
export const member = (node, method) =>
  node?.type === 'MemberExpression' && !node.computed && identifier(node.property, method)

export function walk(node, visit, scope) {
  if (!node?.type) return
  visit(node, scope)
  if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) scope = node
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) for (const item of child) walk(item, visit, scope)
    else if (child?.type) walk(child, visit, scope)
  }
}

export function reactReference(tree, node, name, locals) {
  for (const stmt of tree.program.body) {
    if (stmt.type !== 'ImportDeclaration' || stmt.source.value !== 'react' || stmt.importKind === 'type') continue
    for (const spec of stmt.specifiers) {
      if (locals.has(spec.local.name) || spec.importKind === 'type') continue
      if (spec.type === 'ImportSpecifier' && spec.imported.name === name && identifier(node, spec.local.name))
        return true
      if (
        ['ImportDefaultSpecifier', 'ImportNamespaceSpecifier'].includes(spec.type) &&
        member(node, name) &&
        identifier(node.object, spec.local.name)
      )
        return true
    }
  }
  return false
}

export function returnedValue(fn) {
  if (fn?.body?.type !== 'BlockStatement') return fn?.body
  const statements = fn.body.body
  const last = statements.at(-1)
  if (
    last?.type === 'ReturnStatement' &&
    statements.slice(0, -1).every((s) => s.type === 'VariableDeclaration' && s.kind === 'const')
  )
    return last.argument
}

export function componentFunction(tree, exported, local = false) {
  for (const s of tree.program.body) {
    const decl = s.type === 'ExportNamedDeclaration' ? s.declaration : local && s
    if (decl?.type === 'FunctionDeclaration' && decl.id.name === exported) return decl
    if (decl?.type !== 'VariableDeclaration' || decl.kind !== 'const') continue
    const entry = decl.declarations.find((d) => identifier(d.id, exported))
    if (!entry) continue
    let fn = entry.init
    if (
      fn?.type === 'CallExpression' &&
      fn.arguments.length === 1 &&
      reactReference(tree, fn.callee, 'memo', localBindingNames(tree))
    )
      fn = fn.arguments[0]
    if (['ArrowFunctionExpression', 'FunctionExpression'].includes(fn?.type)) return fn
  }
}

// Return the actual callable body for a named render owner. Compare the
// declaration object as well as its name so a nested binding cannot borrow a
// top-level component's qualification.
export function renderOwnerFunction(tree, owner) {
  if (owner?.type === 'FunctionDeclaration') return owner
  if (owner?.type !== 'VariableDeclarator' || !/^[A-Z]/.test(owner.id?.name)) return
  const declared = tree.program.body.some(statement => {
    const declaration = statement.declaration ?? statement
    return declaration.kind === 'const' && declaration.declarations.includes(owner)
  })
  if (!declared) return
  const fn = componentFunction(tree, owner.id.name, true)
  if (fn && !fn.async && !fn.generator) return fn
}

export function renderedRecord(fn, value, jsx) {
  const aliases = new Set()
  for (const stmt of fn.body.body ?? []) {
    for (const d of stmt.declarations ?? []) {
      if (!identifier(d.init, value) || d.id.type !== 'ObjectPattern') continue
      for (const p of d.id.properties)
        if (p.type === 'ObjectProperty' && !p.computed && identifier(p.value)) aliases.add(p.value.name)
    }
  }
  // Only inspect lexical expressions in the root render, excluding nested functions.
  function reads(expr) {
    if (!expr) return false
    if (identifier(expr)) return aliases.has(expr.name)
    if (member(expr)) return identifier(expr.object, value)
    if (expr.type === 'LogicalExpression') return reads(expr.left) || reads(expr.right)
    if (expr.type === 'ConditionalExpression') return reads(expr.consequent) || reads(expr.alternate)
    if (expr.type === 'TemplateLiteral') return expr.expressions.some(reads)
    return false
  }
  let used = false
  walk(jsx, (node, scope) => {
    if (!scope && node.type === 'JSXExpressionContainer' && reads(node.expression)) used = true
  })
  return used
}

function lookupSource(tree, scope, call, field, locals) {
  if (!identifier(call.callee) || scope?.body.type !== 'BlockStatement') return
  const declarations = scope.body.body
    .filter((s) => s.type === 'VariableDeclaration' && s.kind === 'const')
    .flatMap((s) => s.declarations)
    .filter((d) => d.end < call.start && identifier(d.id, call.callee.name))
  if (declarations.length !== 1) return
  const [decl] = declarations
  let fn = decl.init,
    deps
  if (
    fn?.type === 'CallExpression' &&
    reactReference(tree, fn.callee, 'useCallback', locals) &&
    fn.arguments.length === 2
  ) {
    ;[fn, deps] = fn.arguments
  }
  if (
    !['FunctionExpression', 'ArrowFunctionExpression'].includes(fn?.type) ||
    fn.params.length !== 1 ||
    !identifier(fn.params[0])
  )
    return
  const lookup = returnedValue(fn)
  if (
    lookup?.type !== 'CallExpression' ||
    !member(lookup.callee, 'find') ||
    !identifier(lookup.callee.object) ||
    lookup.arguments.length !== 1
  )
    return
  if (
    deps &&
    !(deps.type === 'ArrayExpression' && deps.elements.some((e) => identifier(e, lookup.callee.object.name)))
  )
    return
  const [predicate] = lookup.arguments,
    compare = returnedValue(predicate)
  if (
    predicate?.type !== 'ArrowFunctionExpression' ||
    predicate.params.length !== 1 ||
    !identifier(predicate.params[0]) ||
    compare?.type !== 'BinaryExpression' ||
    compare.operator !== '==='
  )
    return
  const candidate = predicate.params[0].name,
    argument = fn.params[0].name
  if (candidate === argument) return
  const matching = (left, right) =>
    member(left, field) && identifier(left.object, candidate) && identifier(right, argument)
  if (matching(compare.left, compare.right) || matching(compare.right, compare.left)) return decl
}

export function lookupCorroboration(tree, scope, fn, opening, item, field, locals) {
  if (fn.body.type !== 'BlockStatement') return
  const lexicalReturn = returnedValue(scope)
  if (!lexicalReturn || lexicalReturn.start > fn.start || lexicalReturn.end < fn.end) return
  const declarations = fn.body.body.flatMap((s) => s.declarations ?? [])
  for (const entry of declarations) {
    const call = entry.init
    if (
      !identifier(entry.id) ||
      call?.type !== 'CallExpression' ||
      call.arguments.length !== 1 ||
      !identifier(call.callee) ||
      declarations.some((d) => identifier(d.id, call.callee.name)) ||
      !member(call.arguments[0], field) ||
      !identifier(call.arguments[0].object, item)
    )
      continue
    const owner = lookupSource(tree, scope, call, field, locals)
    if (!owner) continue
    let read = false
    for (const a of opening.attributes) {
      const expr = a.value?.expression
      const unwrapped =
        expr?.type === 'UnaryExpression' && expr.operator === '!'
          ? expr.argument.type === 'UnaryExpression' && expr.argument.operator === '!'
            ? expr.argument.argument
            : expr.argument
          : expr
      if (
        identifier(unwrapped, entry.id.name) ||
        (['MemberExpression', 'OptionalMemberExpression'].includes(unwrapped?.type) &&
          identifier(unwrapped.object, entry.id.name))
      )
        read = true
    }
    if (read) return [owner, entry]
  }
}

export function backingCollection(scope, collection) {
  const params = scope?.params?.[0]
  if (params?.type !== 'ObjectPattern') return
  const inputs = new Set(
    params.properties
      .filter((p) => p.type === 'ObjectProperty' && !p.computed && identifier(p.value))
      .map((p) => p.value.name),
  )
  if (inputs.has(collection)) return { name: collection }
  const declarations =
    scope.body?.body
      ?.filter((s) => s.type === 'VariableDeclaration' && s.kind === 'const')
      .flatMap((s) => s.declarations) ?? []
  const matches = declarations.filter(
    (d) =>
      d.id.type === 'ObjectPattern' &&
      d.id.properties.some((p) => p.type === 'ObjectProperty' && identifier(p.value, collection)),
  )
  if (matches.length !== 1 || matches[0].init?.type !== 'CallExpression') return
  const candidates = matches[0].init.arguments.filter((arg) => identifier(arg) && inputs.has(arg.name))
  if (candidates.length === 1) return { name: candidates[0].name, source: matches[0] }
}
