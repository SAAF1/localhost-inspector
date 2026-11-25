// Inspect the actual stylesheet Vite delivered after its configured CSS pipeline.
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { parse } from '@babel/parser'

export function cssParser(root) {
  const app = createRequire(join(root, 'package.json'))
  return createRequire(app.resolve('vite'))('postcss')
}
export const cssInput = (style) =>
  '--li-css-' +
  createHash('sha256')
    .update(JSON.stringify([style.css?.file ?? '', style.literal, style.property]))
    .digest('hex')
    .slice(0, 24)
export const cssReady = (style) => cssInput(style) + '-ready'
export function paddingParts(value) {
  const [t, r = t, b = t, l = r] = value.trim().split(/\s+/)
  return [t, r, b, l]
}
export const sides = ['top', 'right', 'bottom', 'left']
const scalar = /^(?:0|\d+(?:\.\d+)?(?:px|rem|em)|var\(--[\w-]+\))$/
export function cssFields(decl) {
  const values = decl.value.trim().split(/\s+/)
  if (!values.every((v) => scalar.test(v))) return []
  if (
    decl.prop === 'padding-inline' &&
    styles.get('padding-left')?.utility?.axis === 'inline' &&
    styles.get('padding-right')?.utility?.axis === 'inline' &&
    !/\s+(?![^()]*\))/.test(decl.value) &&
    rule.parent.name === 'layer' &&
    rule.parent.params.trim() === 'utilities'
  ) {
    const left = styles.get('padding-left'),
      right = styles.get('padding-right')
    // Keep the compiler's logical declaration and its exact empty-journal fallback.
    decl.value = 'var(' + cssInput(left) + ', ' + decl.value + ') var(' + cssInput(right) + ', ' + decl.value + ')'
    for (const style of [left, right]) rule.append({ prop: cssReady(style), value: '1' })
    changed = true
  } else if (decl.prop === 'padding' && values.length <= 4) return sides.map((s) => 'padding-' + s)
  return values.length === 1 && /^(gap|width|height|padding-(?:top|right|bottom|left))$/.test(decl.prop)
    ? [decl.prop]
    : []
}
export function baseRule(rule) {
  for (let parent = rule.parent; parent?.type !== 'root'; parent = parent?.parent) {
    if (!parent || parent.type !== 'atrule' || parent.name !== 'layer') return false
  }
  return true
}
export function preparedStyles(root, manifest) {
  if (!manifest) return
  const postcss = cssParser(root)
  return {
    name: 'inspector-imported-css',
    enforce: 'post',
    apply: 'serve',
    transform(code, id) {
      if (!id.endsWith('.css') || id.includes('virtual:') || !code.includes('__vite__css')) return
      const ast = parse(code, { sourceType: 'module' })
      const source = ast.program.body
        .flatMap((n) => n.declarations ?? [])
        .find((n) => n.id.name === '__vite__css')?.init
      if (source?.type !== 'StringLiteral') return
      const file = relative(root, id)
      const byClass = new Map()
      const inventory = JSON.parse(readFileSync(manifest, 'utf8'))
      for (const site of inventory.sites) {
        for (const style of site.styles ?? [site.style]) {
          if (style?.utility && inventory.utilityEntry && inventory.utilityEntry !== file) continue
          if (
            !style ||
            (!style.utility && !style.css) ||
            (style.css && !(style.css.served ?? [style.css.file]).includes(file))
          )
            continue
          const styles = byClass.get(style.literal) ?? new Map()
          styles.set(style.property, style)
          byClass.set(style.literal, styles)
        }
      }
      const sheet = postcss.parse(source.value)
      let changed = false
      sheet.walkRules((rule) => {
        if (!baseRule(rule)) return
        const literal = rule.selector.slice(1).replace(/\\([.\[\]])/g, '$1')
        const styles = rule.selector.startsWith('.') && byClass.get(literal)
        if (!styles) return
        for (const decl of [...rule.nodes]) {
          if (decl.type !== 'decl') continue
          const wrap = (field, value) => {
            // A conditional branch or an independent unlayered rule owns its own value.
            if (
              styles.get(field)?.utility &&
              (rule.parent.type !== 'atrule' ||
                rule.parent.name !== 'layer' ||
                rule.parent.params.trim() !== 'utilities')
            )
              return value
            const style = styles.get(field)
            if (!style || (style.css && (style.css.declaration !== decl.prop || style.css.value !== decl.value)))
              return value
            changed = true
            rule.append({ prop: cssReady(style), value: '1' })
            return 'var(' + cssInput(style) + ', ' + value + ')'
          }
          if (
            decl.prop === 'padding-inline' &&
            styles.get('padding-left')?.utility?.axis === 'inline' &&
            styles.get('padding-right')?.utility?.axis === 'inline' &&
            !/\s+(?![^()]*\))/.test(decl.value) &&
            rule.parent.name === 'layer' &&
            rule.parent.params.trim() === 'utilities'
          ) {
            const left = styles.get('padding-left'),
              right = styles.get('padding-right')
            // Keep the compiler's logical declaration and its exact empty-journal fallback.
            decl.value =
              'var(' + cssInput(left) + ', ' + decl.value + ') var(' + cssInput(right) + ', ' + decl.value + ')'
            for (const style of [left, right]) rule.append({ prop: cssReady(style), value: '1' })
            changed = true
          } else if (decl.prop === 'padding' && styles.has('padding-left') && cssFields(decl).length === 4) {
            const sidesPrepared = sides.map((side) => styles.get('padding-' + side))
            if (!sidesPrepared.every((style) => style?.css?.value === decl.value)) continue
            for (const style of sidesPrepared) rule.append({ prop: cssReady(style), value: '1' })
            decl.value = 'var(' + cssInput({ ...sidesPrepared[0], property: 'padding' }) + ', ' + decl.value + ')'
            changed = true
          } else decl.value = wrap(decl.prop, decl.value)
        }
      })
      if (changed)
        return {
          code: code.slice(0, source.start) + JSON.stringify(sheet.toString()) + code.slice(source.end),
          map: null,
        }
    },
  }
}
