// Resolve a component's declared prop shape from local TypeScript without
// importing or running the inspected project (including its configuration).
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { parse } from '@babel/parser'

const identifier = node => node?.name ?? node?.value
const extensions = ['.ts', '.tsx', '.d.ts', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']
const reactSlots = new Set(['ReactNode', 'ReactElement', 'ElementType', 'ComponentType', 'FC', 'FunctionComponent'])

export function typeModule(ast, file) {
  const declarations = new Map(), imports = new Map(), exports = new Map()
  for (const statement of ast.program.body) {
    const declaration = statement.declaration ?? statement
    if (['TSTypeAliasDeclaration', 'TSInterfaceDeclaration'].includes(declaration.type)) {
      declarations.set(declaration.id.name, declaration)
      if (statement.type === 'ExportNamedDeclaration') exports.set(declaration.id.name, { name: declaration.id.name })
      if (statement.type === 'ExportDefaultDeclaration') exports.set('default', { name: declaration.id.name })
    }
    if (statement.type === 'ImportDeclaration') for (const spec of statement.specifiers) {
      imports.set(spec.local.name, { name: identifier(spec.imported) ?? 'default', from: statement.source.value })
    }
    if (statement.type === 'ExportNamedDeclaration') for (const spec of statement.specifiers) {
      if (spec.local) exports.set(identifier(spec.exported), { name: identifier(spec.local), from: statement.source?.value })
    }
  }
  return { declarations, imports, exports, file }
}

export function createComponentTypeResolver(root) {
  const base = realpathSync(root), cache = new Map()
  return (from, specifier) => {
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) return
    const start = resolve(base, dirname(from), specifier)
    if (!start.startsWith(base + sep)) return
    // NodeNext source imports often use ".js" for a corresponding ".ts" file.
    const stem = /\.[cm]?js$/.test(start) ? start.slice(0, -extname(start).length) : start
    const candidates = [...extensions.map(ext => stem + ext), start, ...extensions.map(ext => join(start, 'index' + ext))]
    for (const path of candidates) {
      if (!extensions.some(ext => path.endsWith(ext))) continue
      const info = statSync(path, { throwIfNoEntry: false })
      if (!info?.isFile() || info.size > 1024 * 1024 || !realpathSync(path).startsWith(base + sep)) continue
      const stamp = [path, info.ino, info.ctimeMs, info.mtimeMs, info.size].join(':')
      if (cache.get(path)?.stamp === stamp) return cache.get(path)
      let module
      try {
        const ast = parse(readFileSync(path, 'utf8'), { sourceType: 'unambiguous', plugins: ['jsx', 'typescript', 'decorators-legacy'] })
        module = typeModule(ast, relative(base, path))
      } catch { /* A failed local type import cannot establish a slot. */ }
      const result = { module, stamp }
      cache.set(path, result)
      return result
    }
  }
}

export function classifyComponentProps(annotation, module, resolveImport) {
  const content = new Set(), choices = new Map(), text = new Set(), booleans = new Set()
  let hostProps = false
  const seen = new Set()
  function lookup(name, scope, exported = false) {
    if (!scope || !name) return
    const link = exported ? scope.exports.get(name) : scope.imports.get(name)
    if (exported && !link) return
    if (link?.from) {
      const cycle = [scope.file, link.from, link.name].join('\0')
      if (seen.has(cycle)) return
      seen.add(cycle)
      try { return lookup(link.name, resolveImport?.(scope.file, link.from)?.module, true) }
      finally { seen.delete(cycle) }
    }
    const local = link?.name ?? name
    if (exported && scope.imports.has(local)) return lookup(local, scope)
    const decl = scope.declarations.get(local)
    if (decl) return { decl, scope }
  }
  function reactType(type, scope) {
    const ref = type?.typeName
    if (ref?.type === 'TSQualifiedName') {
      const prefix = ref.left
      if (identifier(prefix) === 'React' || scope.imports.get(identifier(prefix))?.from === 'react') return identifier(ref.right)
      if ((identifier(prefix) === 'JSX' || identifier(prefix?.right) === 'JSX') && identifier(ref.right) === 'Element') return 'ReactElement'
    }
    const named = scope.imports.get(identifier(ref))
    if (named?.from === 'react') return named.name
  }
  function slot(type, scope) {
    if (!type || seen.has(type)) return false
    seen.add(type)
    try {
      if (type.type === 'TSUnionType') return type.types.some(t => slot(t, scope))
      if (type.type === 'TSFunctionType') return slot(type.typeAnnotation?.typeAnnotation, scope)
      if (reactSlots.has(reactType(type, scope))) return true
      const target = type.type === 'TSTypeReference' && lookup(identifier(type.typeName), scope)
      return target ? slot(target.decl.typeAnnotation, target.scope) : false
    } finally { seen.delete(type) }
  }
  function shape(type, scope) {
    if (!type || seen.has(type)) return
    seen.add(type)
    if (type.type === 'TSPropertySignature') {
      const name = identifier(type.key), value = type.typeAnnotation?.typeAnnotation
      if (slot(value, scope)) content.add(name)
      if (value?.type === 'TSStringKeyword' || value?.type === 'TSNumberKeyword') text.add(name)
      if (value?.type === 'TSBooleanKeyword') booleans.add(name)
      if (value?.type === 'TSUnionType' && value.types.every(t => t.type === 'TSLiteralType' &&
        ['string', 'number', 'boolean'].includes(typeof t.literal.value))) choices.set(name, value.types.map(t => t.literal.value))
      return
    }
    if (type.type === 'TSTypeReference' || type.type === 'TSExpressionWithTypeArguments') {
      const react = reactType(type, scope)
      if (['ComponentProps', 'ComponentPropsWithRef', 'ComponentPropsWithoutRef'].includes(react) &&
          type.typeParameters?.params[0]?.literal?.type === 'StringLiteral') hostProps = true
      if (react === 'PropsWithChildren') {
        content.add('children')
        for (const t of type.typeParameters?.params ?? []) shape(t, scope)
      }
      const target = lookup(identifier(type.typeName ?? type.expression), scope)
      if (target) shape(target.decl, target.scope)
      return
    }
    for (const child of type.members ?? type.types ?? type.extends ?? []) shape(child, scope)
    for (const child of [type.typeAnnotation, type.body]) {
      if (Array.isArray(child)) child.forEach(t => shape(t, scope))
      else shape(child, scope)
    }
  }
  shape(annotation, module)
  return { content, choices, text, booleans, hostProps }
}
