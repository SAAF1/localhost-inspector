// Index explicit component contracts without executing application code.
import { createHash } from 'node:crypto'
import { opendir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from '@babel/parser'
import { classifyComponentProps, createComponentTypeResolver, typeModule } from './component-types.mjs'
export { createComponentTypeResolver } from './component-types.mjs'

const caches = new Map()
const skipped = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'vendor', 'storybook-static'])
const isFunction = node => ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)
const key = node => node?.name ?? node?.value
function walk(node, visit) {
  if (!node?.type || visit(node) === false) return
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) child.forEach(item => walk(item, visit))
    else if (child?.type) walk(child, visit)
  }
}

export function componentContracts(source, file, onContract, resolveImport) {
  if (!source.includes('<')) return []
  const ast = parse(source, { sourceType: 'unambiguous', plugins: ['jsx', 'typescript', 'decorators-legacy'] })
  const recipeChoices = new Map()
  const recipeDefaults = new Map()
  const module = typeModule(ast, file)
  const contexts = new Set(), variants = new Map(), functions = []
  const cvaImports = new Set(), owners = new Map(), wrapperProps = new Map()
  for (const node of ast.program.body) {
    if (node.type === 'ImportDeclaration' && node.source.value === 'class-variance-authority') {
      for (const spec of node.specifiers) if (spec.imported?.name === 'cva') cvaImports.add(spec.local.name)
    }
  }
  walk(ast.program, node => {
    if (node.type === 'VariableDeclarator') {
      let init = node.init
      if (init?.type === 'CallExpression') {
        const ref = init.callee
        const imported = module.imports.get(ref.name ?? ref.object?.name)
        if (imported?.from === 'react' && (imported.name === 'createContext' || ref.property?.name === 'createContext')) contexts.add(node.id.name)
      }
      const annotated = node.id.typeAnnotation?.typeAnnotation
      const annotationName = key(annotated?.typeName?.right ?? annotated?.typeName)
      const annotationImport = module.imports.get(annotationName)
      let props = ['FC', 'FunctionComponent'].includes(annotationImport?.name ?? annotationName) ?
        annotated?.typeParameters?.params[0] : undefined
      while (init?.type === 'CallExpression') {
        const callee = key(init.callee.property ?? init.callee)
        const imported = module.imports.get(init.callee.name ?? init.callee.object?.name)
        const wrapper = init.callee.property ? callee : imported?.name
        if (imported?.from !== 'react' || !['memo', 'forwardRef'].includes(wrapper)) break
        props ??= init.typeParameters?.params[wrapper === 'forwardRef' ? 1 : 0]
        init = init.arguments[0]
      }
      if (init && isFunction(init)) {
        owners.set(init, node.id.name)
        if (props) wrapperProps.set(init, props)
      }
      if (init?.type === 'CallExpression' && cvaImports.has(init.callee.name)) {
        const options = init.arguments[1]?.properties?.find(p => key(p.key) === 'variants')
        const defaults = init.arguments[1]?.properties?.find(p => key(p.key) === 'defaultVariants')
        recipeDefaults.set(node.id.name, new Map((defaults?.value?.properties ?? [])
          .filter(p => !p.computed && ['StringLiteral','BooleanLiteral','NumericLiteral'].includes(p.value?.type))
          .map(p => [key(p.key), p.value.value])))
        const dimensions = new Map()
        for (const dimension of options?.value?.properties ?? []) {
          if (dimension.computed || dimension.value?.type !== 'ObjectExpression') continue
          if (dimension.value.properties.some(p => p.type !== 'ObjectProperty' || p.computed)) continue
          const names = dimension.value.properties.map(p => String(key(p.key)))
          dimensions.set(key(dimension.key), names.map(name => ['true', 'false'].includes(name) ? name === 'true' : name))
        }
        recipeChoices.set(node.id.name, dimensions)
        variants.set(node.id.name, new Set(options?.value?.properties?.map(p => key(p.key))))
      }
    }
    if (isFunction(node) && /^[A-Z]/.test(node.id?.name ?? owners.get(node) ?? '')) functions.push(node)
  })
  const result = []
  for (const fn of functions) {
    const name = fn.id?.name ?? owners.get(fn)
    const param = fn.params[0]
    const annotation = param?.typeAnnotation ?? wrapperProps.get(fn)
    const shape = classifyComponentProps(annotation, module, resolveImport)
    const content = new Set(['children', ...shape.content]), options = new Map(shape.choices)
    const local = new Map(), fields = new Set(), forwarded = new Set()
    if (param?.name) forwarded.add(param.name)
    const defaults = new Map(), propDefaults = new Map()
    const markers = new Set(), roots = new Set()
    function bind(pattern) {
      if (pattern?.type !== 'ObjectPattern') return
      for (const prop of pattern.properties) {
        if (prop.type === 'RestElement' && !pattern.properties.some(p => key(p.key) === 'children')) forwarded.add(prop.argument.name)
        const alias = prop.value?.left ?? prop.value
        if (prop.value?.type === 'AssignmentPattern') propDefaults.set(key(prop.key), prop.value.right)
        if (alias?.name) local.set(alias.name, key(prop.key))
      }
    }
    bind(param)
    function propName(expr) {
      if (expr?.type === 'Identifier' || expr?.type === 'JSXIdentifier') return local.get(expr.name)
      if (['MemberExpression', 'JSXMemberExpression'].includes(expr?.type) && param?.name && expr.object.name === param.name && !expr.computed) return key(expr.property)
    }
    let fragment = false, forwardsChildren = false
    function root(expr) {
      if (expr?.type === 'JSXFragment') fragment = true
      if (expr?.type === 'JSXElement') {
        const el = expr.openingElement
        roots.add(el)
        const supplied = expr.children.some(n => n.type !== 'JSXText' || n.value.trim()) ||
          el.attributes.some(a => key(a.name) === 'children')
        const spread = el.attributes.some(a => a.type === 'JSXSpreadAttribute' && forwarded.has(a.argument.name))
        if (!supplied && spread && !['input','img','area','base','br','col','embed','hr','link','meta','param','source','track','wbr'].includes(key(el.name))) forwardsChildren = true
      }
      if (expr?.type === 'ConditionalExpression') { root(expr.consequent); root(expr.alternate) }
      if (expr?.type === 'LogicalExpression') root(expr.right)
    }
    root(fn.body)
    walk(fn.body, n => {
      if (isFunction(n)) return false
      if (n.type === 'VariableDeclarator' && param?.name && n.init?.name === param.name) bind(n.id)
      if (n.type === 'ReturnStatement') root(n.argument)
      if (n.type === 'JSXElement' || n.type === 'JSXFragment') {
        for (const child of n.children) {
          const name = propName(child.expression)
          if (shape.text.has(name)) fields.add(name)
        }
      }
      if (n.type === 'JSXExpressionContainer' || n.type === 'JSXOpeningElement') {
        if (n.type === 'JSXOpeningElement') {
          const prop = propName(n.name)
          if (prop) fields.add(prop)
        } else walk(n.expression, expression => {
          // A declared boolean controlling a rendered branch is a visibility
          // choice. Structural props such as a polymorphic root need a different contract.
          if (expression.type === 'ConditionalExpression' || (expression.type === 'LogicalExpression' && expression.operator === '&&')) {
            const condition = expression.test ?? expression.left
            const gate = propName(condition.operator === '!' ? condition.argument : condition)
            if (shape.booleans.has(gate)) {
              fields.add(gate)
              options.set(gate, [false, true])
            }
          }
          const prop = propName(expression)
          if (content.has(prop)) fields.add(prop)
          if (expression.type === 'JSXElement' || isFunction(expression)) return false
        })
      }
      if (n.type === 'CallExpression' && variants.has(n.callee.name)) {
        for (const prop of n.arguments[0]?.properties ?? []) {
          const field = propName(prop.value)
          if (field && variants.get(n.callee.name).has(key(prop.key))) {
            fields.add(field)
            const values = recipeChoices.get(n.callee.name)?.get(key(prop.key))
            if (values?.length) options.set(field, values)
            const fallback = recipeDefaults.get(n.callee.name).get(key(prop.key))
            if (fallback !== undefined && !propDefaults.has(field)) defaults.set(field, fallback)
          }
        }
      }
      if (shape.choices.has(propName(n))) fields.add(propName(n))
    })
    // A context provider can accept children without owning a visual layer.
    const visualRoot = [...roots].some(el => !contexts.has(key(el.name.object ?? el.name)))
    if (!visualRoot && !fragment) continue
    // A bare spread on a structural wrapper does not establish a public slot.
    // Count forwarded children alongside an explicit contract, or when the
    // component declares ReactNode children and passes them to its root.
    if (forwardsChildren && (shape.content.has('children') || (fields.size && (!annotation || shape.hostProps)))) {
      fields.add('children')
    }
    for (const el of roots) {
      const attr = el.attributes.find(a => a.name?.name === 'data-slot')
      if (attr?.value?.type === 'StringLiteral') markers.add(attr.value.value)
    }
    for (const [field, expr] of propDefaults) {
      if (fields.has(field) && ['StringLiteral','BooleanLiteral','NumericLiteral'].includes(expr.type)) defaults.set(field, expr.value)
    }
    if (fields.size || markers.size) {
      const editable = Object.fromEntries([...options].filter(([field]) => fields.has(field)))
      const contract = { name, source: file, fields: [...fields].sort(), markers: [...markers].sort(),
        ...(defaults.size ? { defaults: Object.fromEntries(defaults) } : {}),
        ...(Object.keys(editable).length ? { options: editable } : {}) }
      result.push(contract)
      onContract?.(contract, fn, roots)
    }
  }
  return result
}

export async function discoverComponentCatalog(root) {
  const previous = caches.get(root) ?? new Map(), next = new Map(), skippedFiles = []
  const resolveType = createComponentTypeResolver(root)
  async function scan(dir) {
    for await (const item of await opendir(join(root, dir))) {
      if (item.name.startsWith('.') || skipped.has(item.name)) continue
      const file = join(dir, item.name)
      if (item.isDirectory()) { await scan(file); continue }
      if (!item.isFile() || !/\.[cm]?[jt]sx?$/.test(file) || /(?:\.d|\.stories|\.test|\.spec)\.[jt]sx?$/.test(file)) continue
      const path = join(root, file)
      const info = await stat(path)
      if (info.size > 1024 * 1024) { skippedFiles.push(file); continue }
      const old = previous.get(file)
      let record = old
      const stamp = [info.ino, info.ctimeMs, info.mtimeMs, info.size].join(':')
      if (!old || old.stamp !== stamp || old.dependencies.some(dep => resolveType(dep.from, dep.specifier)?.stamp !== dep.stamp)) {
        const code = await readFile(path, 'utf8')
        record = { stamp, dependencies: [] }
        function resolveImport(from, specifier) {
          const result = resolveType(from, specifier)
          if (specifier.startsWith('.')) record.dependencies.push({ from, specifier, stamp: result?.stamp })
          return result
        }
        try { record.contracts = componentContracts(code, file, undefined, resolveImport) }
        catch { record.contracts = []; record.unsupported = true }
      }
      next.set(file, record)
      if (record.unsupported) skippedFiles.push(file)
    }
  }
  await scan('')
  caches.set(root, next)
  const all = [...next.values()].flatMap(file => file.contracts)
  const counts = new Map()
  for (const item of all) for (const marker of item.markers) counts.set(marker, (counts.get(marker) ?? 0) + 1)
  const definitions = all.filter(item => item.fields.length).map(item => ({
    ...item, markers: item.markers.filter(marker => counts.get(marker) === 1),
  })).sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name))
  const revision = createHash('sha256').update(JSON.stringify(definitions.map(({name, source, fields, markers}) => ({ name, source, fields, markers })))).digest('hex')
  return { definitions, revision, skippedFiles: skippedFiles.sort() }
}
