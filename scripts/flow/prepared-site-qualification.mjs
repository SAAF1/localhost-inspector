import { componentFingerprint } from './component-proof.mjs'
import { literalStyleInput } from './component-parts.mjs'
import { classMemberExpression } from './class-composition.mjs'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const styleProperties = new Set([
  'gap',
  'padding-left',
  'padding-right',
  'padding-top',
  'padding-bottom',
  'width',
  'height',
  'min-width',
  'max-width',
  'min-height',
  'max-height',
  'font-weight',
  'font-size',
  'border-radius',
  'color',
  'background-color',
])
function walk(node, visit, owner) {
  if (!node?.type) return
  if (node.type === 'FunctionDeclaration' && /^[A-Z]/.test(node.id?.name)) owner = node
  if (!owner && node.type === 'VariableDeclarator' && node.id.type === 'Identifier') owner = node
  visit(node, owner)
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const child of value) walk(child, visit, owner)
    else if (value?.type) walk(value, visit, owner)
  }
}

export function moduleReference(opening, imports, joins) {
  const expression = classMemberExpression(opening, joins)
  if (expression?.type !== 'MemberExpression' || expression.object.type !== 'Identifier') return
  const file = imports.get(expression.object.name)
  const member = expression.computed ? expression.property.type === 'StringLiteral' && expression.property.value : expression.property.name
  if (file && member) return { file, member }
}

export function literalColorAttribute(node) {
  const styles = node.attributes.filter(a => a.name?.name === 'style')
  if (styles.length !== 1) return
  const expression = styles[0].value?.expression
  const property = expression?.properties?.[0]
  if (expression?.type === 'ObjectExpression' && expression.properties.length === 1 &&
      property.type === 'ObjectProperty' && !property.computed && property.key.name === 'color' &&
      property.value.type === 'StringLiteral') return styles[0]
}

export function panelOpening(code, node) {
  const attr = literalColorAttribute(node)
  if (!attr) return code.slice(node.start, node.end)
  let start = attr.start
  while (start > node.name.end && code[start - 1] === ' ') start--
  return code.slice(node.start, start) + code.slice(attr.end, node.end)
}

export function matchesPreparedOpening(site, code, node) {
  return code.slice(node.start, node.end) === site.opening ||
    (site.styles?.some(s => s.local) && /^[a-z]/.test(node.name.name) &&
      panelOpening(code, node) === site.opening)
}

export function preparedOpenings(tree) {
  const openings = []
  walk(tree.program, (node, owner) => {
    if (node.type === 'JSXElement' && owner)
      openings.push({ node: node.openingElement, element: node, children: node.children, owner })
  })
  return openings
}

// Qualify the entire site before registering CSS or changing even one source span.
export function preparedStyleTargets(site, node, code) {
  const targets = []
  for (const style of site.styles ?? (site.style ? [site.style] : [])) {
    const { attribute, property, literal } = style
    if (style.part === 'surface') {
      if (!site.surface || site.surface.file!==style.css?.file || site.surface.member!==style.css?.member ||
          !['background-color','border-radius'].includes(property)) return
      targets.push({style})
      continue
    }
    if (style.styleInput) {
      const value = literalStyleInput(node, property)
      if (property !== 'height' || !value || value.value !== style.base) return
      targets.push({style,start:value.start,end:value.end})
      continue
    }
    if (style.css?.member && site.moduleClass?.file === style.css.file &&
        site.moduleClass.member === style.css.member && styleProperties.has(property)) {
      targets.push({ style })
      continue
    }
    if (style.css?.selector && styleProperties.has(property) && !node.attributes.some(a => a.type === 'JSXSpreadAttribute')) {
      targets.push({ style })
      continue
    }
    if (style.local && styleProperties.has(property)) {
      if (node.attributes.some(a => a.type === 'JSXSpreadAttribute' || (a.name?.name === 'style' && a !== literalColorAttribute(node)))) return
      targets.push({ style })
      continue
    }
    const value = node.attributes.find((a) => a.name?.name === attribute)?.value
    if (!styleProperties.has(property) || !value || typeof literal !== 'string' || !literal) return
    if (style.utility || style.css) {
      if (
        attribute !== 'className' ||
        value.type !== 'StringLiteral' ||
        (!style.forwarded && !value.value.split(/[\t\n\f\r ]+/).includes(literal))
      )
        return
      targets.push({ style })
    } else {
      const expression = code.slice(value.start, value.end)
      const index = expression.indexOf(literal)
      if (index < 0 || expression.indexOf(literal, index + 1) >= 0) return
      const start = value.start + index,
        end = start + literal.length
      if (targets.some((t) => t.start < end && start < t.end)) return
      targets.push({ style, start, end })
    }
  }
  return targets
}

// The runtime and transaction planner must compute the identical revision.
export function preparedRevision(root, namespace, site, code, tree, owner, dependencies) {
  const hash = createHash('sha256').update(JSON.stringify([namespace, site, code.slice(owner.start, owner.end)]))
  for (const statement of tree.program.body) {
    const name = (statement.declaration ?? statement).id?.name
    if (statement.type === 'ImportDeclaration' || site.symbols?.includes(name))
      hash.update(code.slice(statement.start, statement.end))
  }
  for (const path of site.dependencies ?? []) {
    if (!dependencies.has(path)) {
      try { dependencies.set(path, readFileSync(join(root, path))) }
      catch (error) {
        if (error.code !== 'ENOENT') throw error
        return null
      }
    }
    const proof = site.componentProof?.[path]
    if (proof) {
      const key = 'component:' + path
      try {
        if (!dependencies.has(key)) dependencies.set(key,componentFingerprint(dependencies.get(path).toString()))
      } catch { return null }
      if (dependencies.get(key) !== proof) return null
      hash.update(proof)
    } else hash.update(dependencies.get(path))
  }
  return hash.digest('hex')
}
