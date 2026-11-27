import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { localBindingNames } from './authored-use.mjs'
import { parseAuthoredJsx } from './authored-forwarding.mjs'
import { componentFingerprint } from './component-proof.mjs'
import { baseRule, cssFields, cssParser } from './prepared-css.mjs'
import { inlinePadding, preparedOpenings } from './prepared-site-qualification.mjs'
import { renderOwnerFunction } from './record-render-path.mjs'

const prop = '__liPreviewPlacement'
const slug = /^[a-z][a-z0-9-]{0,45}$/
const sourceFile = /^(?:[\w-]+\/)*[\w.-]+$/
const knownProperties = new Set(['border-radius', 'padding-top'])
const plainOpening = node => node.attributes.every(attr => attr.type === 'JSXAttribute' &&
  !String(attr.name.name).startsWith('data-li-') && attr.name.name !== prop)

function read(root, file, suffix) {
  if (typeof file !== 'string' || !sourceFile.test(file) || !suffix.test(file)) throw Error('Invalid binding source file.')
  const path = join(root, file)
  if (realpathSync(path) !== path) throw Error('A binding source must be in the working copy.')
  return readFileSync(path, 'utf8')
}

function anchor(root, spec) {
  const code = read(root, spec.file, /\.[jt]sx$/)
  const tree = parseAuthoredJsx(code)
  const owner = tree.program.body.flatMap(item => {
    const declaration = item.declaration ?? item
    return declaration.declarations ?? [declaration]
  }).find(item => item.id?.name === spec.owner)
  const fn = owner && renderOwnerFunction(tree, owner)
  if (!fn) throw Error('A mapped opening needs a local render function.')
  const hits = preparedOpenings(tree).filter(hit => hit.owner === owner &&
    code.slice(hit.node.start, hit.node.end) === spec.opening && plainOpening(hit.node))
  if (hits.length !== 1) throw Error('Mapped source opening is missing or ambiguous.')
  return { code, tree, fn, node: hits[0].node, element: hits[0].element }
}

function directRender(fn, element, allowRepeat) {
  // Do not treat calls inside callbacks, loops or array literals as a static placement.
  function visit(node, root = false) {
    if (node === element) return true
    if (!node?.type || (!root && !allowRepeat && /Function|Method|^For|^While|^DoWhile|^ArrayExpression$/.test(node.type))) return false
    return Object.values(node).some(value =>
      Array.isArray(value) ? value.some(child => visit(child)) : visit(value))
  }
  return visit(fn.body, true)
}

function stylesheetStyles(root, graph, spec, host, properties) {
  const entry = graph.sheets.find(sheet => sheet.file === spec.file)
  if (!entry || typeof spec.selector !== 'string' || !/^(?:\.[\w-]+\s+)*\.[\w-]+$/.test(spec.selector))
    throw Error('The selected stylesheet rule must be served and name the mapped class.')
  const classes = host.attributes.find(attr => attr.name?.name === 'className')?.value
  if (classes?.type !== 'StringLiteral' || !classes.value.split(/\s+/).includes(spec.selector.split(/\s+/).at(-1).slice(1)) ||
      host.attributes.some(attr => attr.name?.name === 'style')) throw Error('The mapped class is not the native source owner.')
  const file = read(root, spec.file, /\.css$/)
  const tree = cssParser(root).parse(file)
  const byProperty = new Map(properties.map(property => [property, []]))
  tree.walkRules(rule => {
    if (rule.selector !== spec.selector) return
    for (const [property, declarations] of byProperty) {
      const related = rule.nodes.filter(declaration => declaration.type === 'decl' &&
        (declaration.prop === property || (property === 'padding-top' &&
          /^(?:padding$|padding-(?:block|inline))/.test(declaration.prop))))
      if (!related.length) continue
      const [decl] = related
      if (related.length !== 1 || decl.important || !cssFields(decl).includes(property))
        throw Error('The mapped CSS declaration is ambiguous or unsupported.')
      declarations.push({declaration:decl.prop,value:decl.value,base:baseRule(rule)})
    }
  })
  const styles = []
  for (const [property, declarations] of byProperty) {
    if (declarations.filter(d => d.base).length !== 1) throw Error('The mapped CSS declaration lacks one base owner.')
    styles.push({property,literal:spec.selector,css:{file:spec.file,selector:spec.selector,
      mappedDeclarations:declarations,served:entry.served}})
  }
  return styles
}

function staticInvocation(root, placement, host, resolved) {
  const { node, tree, fn, element, code } = anchor(root, placement)
  const imported = tree.program.body.find(statement => statement.type === 'ImportDeclaration' &&
    statement.specifiers.some(spec => spec.local.name === node.name.name && spec.type === 'ImportDefaultSpecifier'))
  if (!imported || !/^[A-Z]/.test(node.name.name) || localBindingNames(tree).has(node.name.name) ||
      resolved.get(JSON.stringify([placement.file, imported.source.value])) !== host.spec.file ||
      !directRender(fn, element, false) || node.attributes.some(attr => attr.name?.name === 'key') ||
      !host.tree.program.body.some(item => item.type === 'ExportDefaultDeclaration' &&
        (item.declaration.name ?? item.declaration.id?.name) === host.spec.owner) ||
      host.fn.params[0]?.type !== 'ObjectPattern' || /\b__liPreviewPlacement\b/.test(code + host.code))
    throw Error('The invocation does not prove a direct imported placement and native part.')
  return { ...placement, component: host.spec.file }
}

export function mappedPreviewSites(root, map, graph, resolved, boundary) {
  if (!map) return []
  if (map.version !== 1 || !Array.isArray(map.bindings) || !map.bindings.length || map.bindings.length > 12)
    throw Error('Invalid shared preview binding map.')
  const ids = new Set(), owners = new Set()
  return map.bindings.map(spec => {
    const { id, scope, host, invocation, css, properties } = spec
    const key = JSON.stringify(host)
    if (!slug.test(id ?? '') || ids.has(id) || owners.has(key) || !['selected','shared'].includes(scope) ||
        !Array.isArray(properties) || !properties.length || new Set(properties).size !== properties.length ||
        properties.some(p => !knownProperties.has(p)) || !host?.file?.startsWith(boundary + '/') ||
        (invocation && (scope !== 'selected' || !invocation.file?.startsWith(boundary + '/'))))
      throw Error('Invalid shared preview binding.')
    ids.add(id)
    owners.add(key)
    const source = anchor(root, host)
    if (!/^[a-z][\w-]*$/.test(source.node.name.name) ||
        !directRender(source.fn, source.element, scope === 'shared'))
      throw Error('The mapped part must be an authored native render opening.')
    const placement = invocation && staticInvocation(root, invocation, {...source,spec:host}, resolved)
    const padding = !css && inlinePadding(source.node)
    const styles = css ? stylesheetStyles(root, graph, css, source.node, properties) :
      padding && properties.length === 1 && properties[0] === 'padding-top' &&
        [{property:'padding-top', tag:source.node.name.name, inlinePadding:true, base:padding.base}]
    if (!styles) throw Error('The mapped inline padding has no unambiguous static shorthand.')
    const relevantCSS = [...new Set(graph.sheets.map(sheet => sheet.file))]
    const dependencies = [...relevantCSS, ...(placement ? [placement.file] : [])]
    return { ...host, id:'mapped-' + id, styles, dependencies, mapping:{scope, properties, ...(placement ? {invocation:placement} : {})},
      ...(placement ? {componentProof:{[placement.file]:componentFingerprint(read(root, placement.file,/\.[jt]sx$/))}} : {}) }
  })
}

export function markMappedPlacements(file, sites, code, tree, out) {
  let changed = false
  for (const site of sites) {
    const placement = site.mapping?.invocation
    if (placement?.file !== file || componentFingerprint(code) !== site.componentProof[file]) continue
    const opening = preparedOpenings(tree).find(({node,owner}) => owner.id.name === placement.owner &&
      code.slice(node.start,node.end) === placement.opening)?.node
    if (!opening) continue
    out.appendLeft(opening.attributes.at(-1)?.end ?? opening.name.end, ' ' + prop + '=' + JSON.stringify(site.id))
    changed = true
  }
  return changed
}

export function mappedHostGate(tree, site, owner, out) {
  if (!site.mapping?.invocation) return ''
  const parameter = renderOwnerFunction(tree,owner)?.params[0]
  if (parameter?.type !== 'ObjectPattern') return null
  out.appendLeft(parameter.start + 1, prop + ',')
  return prop + ' === ' + JSON.stringify(site.id)
}
