import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import MagicString from 'magic-string'
import { authoredImports, forwardedHost, parseAuthoredJsx } from './authored-forwarding.mjs'

const schema = 1
const marker = 'data-li-authored-use'
const digest = (text) => createHash('sha256').update(text).digest('hex')
const jsxFile = /\.[jt]sx$/
const px = /^(?:0|[1-9]\d{0,3})(?:\.\d{1,3})?px$/
const paint =
  /^(?:#[\da-f]{3,8}|[a-z]+|var\(--[\w-]+\)|(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch|color)\([\w.%, /+-]+\))$/i
const allowed = { paint: ['color'], spacing: ['gap', 'justifyContent'] }

function fileInside(root, file) {
  if (typeof file !== 'string') throw Error('Authored use must reference project JSX source.')
  const full = resolve(root, file)
  if (
    isAbsolute(file) ||
    file.startsWith('../') ||
    relative(root, full) !== file ||
    !jsxFile.test(file) ||
    file.split('/').includes('node_modules')
  )
    throw Error('Authored use must reference project JSX source.')
  if (realpathSync(full) !== full) throw Error('Authored use may not reference linked source.')
  return full
}

function walkSource(node, visit, owner = '') {
  if (!node?.type) return
  if (node.type === 'FunctionDeclaration' || node.type === 'VariableDeclarator') {
    if (node.id?.type === 'Identifier') owner = owner + '/' + node.id.name
  }
  visit(node, owner)
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) for (const entry of child) walkSource(entry, visit, owner)
    else if (child?.type) walkSource(child, visit, owner)
  }
}

function markBindings(pattern, locals) {
  switch (pattern?.type) {
    case 'Identifier':
      locals.add(pattern.name)
      break
    case 'ObjectPattern':
      for (const entry of pattern.properties) markBindings(entry.value ?? entry.argument, locals)
      break
    case 'ArrayPattern':
      for (const entry of pattern.elements) markBindings(entry, locals)
      break
    case 'AssignmentPattern':
      markBindings(pattern.left, locals)
      break
    case 'RestElement':
      markBindings(pattern.argument, locals)
      break
  }
}

function paintPart(element) {
  if (element.openingElement.attributes.some((attr) => attr.name?.name === 'dangerouslySetInnerHTML'))
    return false
  let leaf = true
  for (const child of element.children)
    walkSource(child, (node) => {
      if (node.type === 'JSXElement' || node.type === 'JSXFragment') leaf = false
    })
  return leaf
}

function authoredStyle(opening, family, code) {
  const styles = opening.attributes.filter((attr) => attr.name?.name === 'style')
  if (!styles.length) return { start: opening.name.end, end: opening.name.end, values: {} }
  if (styles.length !== 1) return
  const [style] = styles
  const expression = style.value?.expression
  if (expression?.type !== 'ObjectExpression') return
  const values = {}
  for (const property of expression.properties) {
    if (
      property.type !== 'ObjectProperty' ||
      property.computed ||
      !allowed[family].includes(property.key.name) ||
      Object.hasOwn(values, property.key.name) ||
      property.value.type !== 'StringLiteral'
    )
      return
    values[property.key.name] = property.value.value
  }
  let start = style.start
  while (start > opening.name.end && code[start - 1] === ' ') start--
  return { start, end: style.end, values }
}

function sourceUses(code, tree, file, components) {
  const elements = []
  const locals = new Set()
  walkSource(tree.program, (node, owner) => {
    if (node.type === 'JSXElement') elements.push({ element: node, owner })
    if (
      ['VariableDeclarator', 'FunctionDeclaration', 'FunctionExpression', 'ClassDeclaration'].includes(
        node.type,
      )
    )
      markBindings(node.id, locals)
    if (node.params) for (const param of node.params) markBindings(param, locals)
    if (node.type === 'CatchClause') markBindings(node.param, locals)
  })
  return elements.flatMap(({ element, owner }) => {
    const opening = element.openingElement
    const name = opening.name.name
    if (
      !name ||
      opening.attributes.some((attr) => attr.name?.name === marker || attr.type === 'JSXSpreadAttribute')
    )
      return []
    // Forwarded components take precedence. Native roots with a rest spread
    // already carry the component-use marker, so they were excluded above.
    const component = !locals.has(name) && components.get(name)
    const family = component
      ? 'spacing'
      : /^[a-z][a-z0-9]*$/.test(name) && paintPart(element)
        ? 'paint'
        : null
    if (!family) return []
    const tag = component?.tag ?? name
    const style = authoredStyle(opening, family, code)
    if (!style) return []
    const anchor = code.slice(element.start, style.start) + code.slice(style.end, element.end)
    const dependencies = component ? [component.dependency] : []
    const locator = { owner, host: name, structure: digest(anchor) }
    const id = digest(JSON.stringify([file, locator, family, dependencies.map(({ file }) => file)]))
    const revision = digest(
      JSON.stringify([code.slice(element.start, element.end), dependencies, component?.imported]),
    )
    return [{ opening, style, binding: { schema, id, family, file, tag, locator, revision, dependencies } }]
  })
}

export async function addAuthoredUseMarkers({
  root,
  file,
  code,
  tree,
  out,
  resolveImport,
  reserved = new Set(),
}) {
  const components = new Map()
  const useNames = new Set()
  const resolved = new Map()
  walkSource(tree.program, (node) => {
    if (node.type === 'JSXOpeningElement') useNames.add(node.name.name)
  })
  for (const [name, imported] of authoredImports(tree)) {
    if (!/^[A-Z]/.test(name) || !useNames.has(name)) continue
    try {
      if (!resolved.has(imported.specifier))
        resolved.set(imported.specifier, await resolveImport(imported.specifier))
      const path = resolved.get(imported.specifier)
      if (!path) continue
      const dependency = relative(root, path)
      if (!jsxFile.test(dependency)) continue
      const source = readFileSync(fileInside(root, dependency), 'utf8')
      const tag = forwardedHost(source, imported.exported)
      if (tag)
        components.set(name, {
          tag,
          imported,
          dependency: { file: dependency, revision: digest(source), ...imported },
        })
    } catch {
      // Leave opaque, stale and external imports without writable provenance.
    }
  }
  const uses = sourceUses(code, tree, file, components)
  const counts = new Map()
  for (const { binding } of uses) counts.set(binding.id, (counts.get(binding.id) ?? 0) + 1)
  let changed = false
  for (const { opening, binding } of uses) {
    if (counts.get(binding.id) !== 1 || reserved.has(opening.start)) continue
    out.appendLeft(opening.name.end, ' ' + marker + '={' + JSON.stringify(JSON.stringify(binding)) + '}')
    changed = true
  }
  return changed
}

export function authoredUseSites(root) {
  root = realpathSync(root)
  return {
    name: 'inspector-authored-use',
    enforce: 'pre',
    apply: 'serve',
    transform: {
      order: 'pre',
      async handler(code, id) {
        const file = relative(root, id)
        if (!jsxFile.test(file) || file.startsWith('../') || file.split('/').includes('node_modules')) return
        let tree
        try {
          tree = parseAuthoredJsx(code)
        } catch {
          // Vite's application plugins still own support for this syntax.
          return
        }
        const out = new MagicString(code)
        if (
          await addAuthoredUseMarkers({
            root,
            file,
            code,
            tree,
            out,
            resolveImport: async (specifier) => (await this.resolve(specifier, id))?.id,
          })
        )
          return { code: out.toString(), map: out.generateMap({ hires: true, source: id }) }
      },
    },
  }
}

function readBinding(root, code, claimed, expectedDependencies = claimed.dependencies) {
  if (claimed?.schema !== schema || !['paint', 'spacing'].includes(claimed.family)) {
    throw Error('Unsupported authored-use binding.')
  }
  const tree = parseAuthoredJsx(code)
  const components = new Map()
  if (claimed.family === 'spacing') {
    if (expectedDependencies?.length !== 1)
      throw Error('A forwarded use needs exactly one verified dependency.')
    const [dependency] = expectedDependencies
    const source = readFileSync(fileInside(root, dependency.file), 'utf8')
    if (digest(source) !== dependency.revision) throw Error('Authored-use forwarding dependency changed.')
    for (const [name, imported] of authoredImports(tree)) {
      if (imported.specifier !== dependency.specifier || imported.exported !== dependency.exported) continue
      const tag = forwardedHost(source, imported.exported)
      if (tag) components.set(name, { tag, imported, dependency })
    }
  }
  const matches = sourceUses(code, tree, claimed.file, components).filter(
    ({ binding }) => binding.id === claimed.id,
  )
  if (matches.length !== 1 || matches[0].binding.tag !== claimed.tag)
    throw Error('Authored use is absent or ambiguous in the current source.')
  return matches[0]
}

function transaction(file, before, after, binding, nextBinding, patch, properties) {
  const values = Object.fromEntries(
    Object.entries(properties).map(([key, value]) => [
      key === 'justifyContent' ? 'justify-content' : key,
      value,
    ]),
  )
  return {
    file,
    before,
    after,
    beforeRevision: digest(before),
    afterRevision: digest(after),
    binding,
    nextBinding,
    patch,
    values,
  }
}

export function planAuthoredUse(root, claimed, values) {
  root = realpathSync(root)
  const before = readFileSync(fileInside(root, claimed.file), 'utf8')
  const { binding, style } = readBinding(root, before, claimed)
  if (binding.revision !== claimed.revision) throw Error('Authored use changed since it was observed.')
  let properties
  if (binding.family === 'paint') {
    if (Object.keys(values).length !== 1 || typeof values.color !== 'string' || !paint.test(values.color))
      throw Error('Expected a bounded CSS color or a named CSS variable.')
    properties = { color: values.color }
  } else {
    const gap = values.gap ?? style.values.gap ?? '0px'
    if (
      !Object.keys(values).length ||
      Object.keys(values).some((key) => !['gap', 'justify-content'].includes(key)) ||
      (Object.hasOwn(values, 'justify-content') && values['justify-content'] !== 'flex-start') ||
      typeof gap !== 'string' ||
      !px.test(gap)
    )
      throw Error('Expected a nonnegative pixel gap and start distribution.')
    properties = { justifyContent: 'flex-start', gap }
  }
  const patch = {
    start: style.start,
    before: before.slice(style.start, style.end),
    after:
      ' style={{ ' +
      Object.entries(properties)
        .map(([key, value]) => key + ': ' + JSON.stringify(value))
        .join(', ') +
      ' }}',
  }
  const after = before.slice(0, style.start) + patch.after + before.slice(style.end)
  const next = readBinding(root, after, binding).binding
  return transaction(binding.file, before, after, binding, next, patch, properties)
}

export function reverseAuthoredUse(root, receipt) {
  root = realpathSync(root)
  const { binding, nextBinding, patch } = receipt
  const before = readFileSync(fileInside(root, binding.file), 'utf8')
  const current = readBinding(root, before, nextBinding)
  const { style } = current
  if (
    current.binding.revision !== nextBinding.revision ||
    before.slice(style.start, style.end) !== patch.after
  )
    throw Error('Authored use has changed since the source write.')
  const after = before.slice(0, style.start) + patch.before + before.slice(style.end)
  const restored = readBinding(root, after, binding)
  if (restored.binding.revision !== binding.revision)
    throw Error('Authored undo would restore an unexpected source revision.')
  return transaction(
    binding.file,
    before,
    after,
    current.binding,
    restored.binding,
    {
      start: style.start,
      before: patch.after,
      after: patch.before,
    },
    restored.style.values,
  )
}
