// Bind the authored host to a declaration actually delivered by Vite. The
// winning marker follows the rule's cascade. The editable value is local to
// the marked part and only consumed inside the exact declaration.
import { createHash } from 'node:crypto'

const fields = ['background-color', 'border-radius', 'font-size']
const color = /^(?:#[\da-f]{3,8}|[a-z]+|(?:var|rgba?|hsla?|oklch|oklab|color)\([^;{}]+\))$/i
const cssWide = /^(?:inherit|unset|initial|revert(?:-layer)?)$/i
function affects(property, field) {
  return property === field || property === 'all' ||
    (field === 'font-size' && property === 'font') ||
    (field === 'background-color' && property === 'background') ||
    (field === 'border-radius' && /^border-.+-radius$/.test(property))
}

function unconditional(rule) {
  // Exclude pseudo states, theme selectors, nesting, and grouping. A single
  // class or tag may recur in another template; the operation is still gated
  // by the selected authored use and never written to all class consumers.
  if (rule.selector.length > 240 || !/^(?:\.(?:[\w-]|\\[^\s])+|[a-z][\w-]*)$/.test(rule.selector)) return false
  for (let parent = rule.parent; parent?.type !== 'root'; parent = parent?.parent)
    if (!parent || parent.type !== 'atrule' || parent.name !== 'layer') return false
  return true
}

export function bindRenderedDeclarations(sheet, file, originalValues) {
  if (!file || file.startsWith('/') || file.split('/').includes('..') || file.length > 240) return false
  const registered = new Set()
  const candidates = new Map()
  const basisFor = decl => {
    const layers = []
    for (let parent = decl.parent.parent; parent?.type === 'atrule'; parent = parent.parent)
      layers.push([parent.name,parent.params])
    return JSON.stringify([file,decl.parent.selector,decl.prop,originalValues?.get(decl) ?? decl.value,layers])
  }
  sheet.walkDecls(decl => {
    if (!fields.some(field => affects(decl.prop,field)) || decl.parent.type !== 'rule' || !unconditional(decl.parent)) return
    const basis = basisFor(decl)
    candidates.set(basis,(candidates.get(basis) ?? 0)+1)
  })
  sheet.walkRules(rule => {
    for (const decl of [...rule.nodes]) {
      if (decl.type !== 'decl') continue
      const value = originalValues?.get(decl) ?? decl.value
      for (const property of fields.filter(field => affects(decl.prop, field))) {
        const marker = '--li-owner-' + property
        let basis = 'unavailable'
        const simplePaint = property === 'background-color' && decl.prop === 'background' && color.test(value)
        if (unconditional(rule) && !cssWide.test(value) && (decl.prop === property || simplePaint) &&
            !value.includes('--li-') && value.length <= 200 && !decl.important && candidates.get(basisFor(decl)) === 1) {
          const id = createHash('sha256').update(basisFor(decl)).digest('hex').slice(0,32)
          const input = '--li-render-' + id
          basis = JSON.stringify(encodeURIComponent(JSON.stringify([id,file,rule.selector])))
          decl.value = 'var(' + input + ', ' + decl.value + ')'
          registered.add(input)
        }
        rule.append({prop:marker,value:basis,important:decl.important})
        registered.add(marker)
      }
    }
  })
  if (registered.size) sheet.append([...registered].map(name =>
    '@property ' + name + '{syntax:"*";inherits:false;}').join('\n'))
  return registered.size > 0
}
