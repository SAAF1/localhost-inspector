const pixelProperties = new Set(['font-size','line-height','letter-spacing','gap','width','height','min-width','max-width',
  'min-height','max-height','padding','padding-top','padding-right','padding-bottom','padding-left','border-radius','border-width'])
const keywords = {
  'flex-direction': ['row','column','row-reverse','column-reverse'],
  'justify-content': ['normal','start','center','end','space-between','space-around','space-evenly','stretch','flex-start','flex-end'],
  'align-items': ['normal','start','center','end','stretch','baseline','last baseline','flex-start','flex-end'],
  'justify-items': ['normal','start','center','end','stretch'],
  'text-align': ['start','center','end','left','right','justify'],
}
// Chromium's serialized solid colors, including values used when detaching a token.
const modernColor = /^(?:oklch|oklab|lch|lab|color)\((?:[a-z][a-z0-9-]* )?[-\d.%e+ /]+\)$/i
export const colors = new Set(['color','background-color','border-color'])
export function validValue(property, value) {
  if (typeof value !== 'string' || value.length > (property === 'font-family' ? 512 : 100)) return false
  if (property === 'width' && ['100%', 'fit-content'].includes(value)) return true
  if (['min-width', 'min-height'].includes(property) && value === 'auto') return true
  if (['max-width', 'max-height'].includes(property) && value === 'none') return true
  if (pixelProperties.has(property)) return /^-?\d+(\.\d+)?px$/.test(value)
  if (property === 'font-family') return validTextStyleValue(property, value)
  if (property === 'font-weight') return /^(normal|bold|[1-9]00)$/.test(value)
  const solidPaint = colors.has(property) || ['fill', 'stroke', 'outline-color'].includes(property) ||
    /^border-(top|right|bottom|left)-color$/.test(property)
  if (solidPaint && modernColor.test(value)) return true
  if (solidPaint) return /^(#[0-9a-f]{3,8}|rgba?\([\d.,% /]+\)|[a-z]{3,20})$/i.test(value)
  return Object.hasOwn(keywords, property) && keywords[property].includes(value)
}
export function validTargetKey(key) {
  return key == null || (typeof key === 'string' && key.length <= 120 && key.trim().length > 0)
}
export function validTextStyleValue(property, value) {
  if (typeof value !== 'string' || !value || value.length > (property === 'font-family' ? 512 : 100)) return false
  if (property === 'font-family') {
    // CSSOM family lists contain names and quoted names, not CSS functions.
    const family = /(?:"[^"\r\n\\{};]+"|'[^'\r\n\\{};]+'|[\p{L}\p{N}_-]+(?: +[\p{L}\p{N}_-]+)*)/u
    return new RegExp('^' + family.source + '(?: *, *' + family.source + ')*$', 'u').test(value)
  }
  if (property === 'font-weight') return /^\d+(?:\.\d+)?$/.test(value) && Number(value) >= 1 && Number(value) <= 1000
  if (property === 'line-height' || property === 'letter-spacing') {
    if (value === 'normal') return true
  }
  return /^-?\d+(?:\.\d+)?px$/.test(value) && (property === 'letter-spacing' || !value.startsWith('-'))
}
export function validRoute(route) {
  return typeof route === 'string' && route.startsWith('/') && route.length <= 2048
}
export const templateFingerprint = value => typeof value === 'string' && /^(?:v2:)?[a-f0-9]{64}$/.test(value)
export const targetFingerprint = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
export function validScopedTarget(target) {
  const { anchor, id, key, tag, textFingerprint, regionFingerprint, classFingerprint } = target
  if (anchor === undefined) return true
  return !id && !key && anchor && ['id', 'key', 'main', 'landmark', 'section'].includes(anchor.kind) &&
    (anchor.kind !== 'main' || anchor.value === 'main') &&
    (anchor.kind !== 'section' || (anchor.value === 'section' && /^(h[1-6]|p)$/.test(tag))) &&
    (anchor.kind !== 'landmark' || ['navigation', 'complementary'].includes(anchor.value)) &&
    typeof anchor.value === 'string' && anchor.value.length > 0 && validTargetKey(anchor.value) &&
    typeof anchor.path === 'string' && /^[a-z][a-z0-9-]{0,39}(>[a-z][a-z0-9-]{0,39}){0,7}$/.test(anchor.path) &&
    anchor.path.split('>').at(-1) === tag &&
    [textFingerprint, regionFingerprint, classFingerprint].every(targetFingerprint)
}
export function journalTarget({ tag, id, slot, key, anchor, textFingerprint, regionFingerprint, classFingerprint, contextFingerprint }) {
  return { tag, id, slot, key, ...(anchor ? { anchor: { kind: anchor.kind, value: anchor.value, path: anchor.path } } : {}),
    textFingerprint, regionFingerprint, classFingerprint, contextFingerprint }
}
export function declaresVariable(css, name) {
  return new RegExp('(?:^|[;{])\\s*' + name + '\\s*:').test(css)
}

export const variableName = /^--[a-zA-Z_][a-zA-Z0-9_-]{0,79}$/
export const textStyleProperties = ['font-family', 'font-weight', 'font-size', 'line-height', 'letter-spacing']
