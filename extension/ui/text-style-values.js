(() => {
  const ui = window.LocalhostInspector
  const properties = ['font-family', 'font-weight', 'font-size', 'line-height', 'letter-spacing']
  const namePattern = /^--[a-zA-Z_][a-zA-Z0-9_-]{0,78}$/
  const length = /^-?(?:\d+(?:\.\d+)?|\.\d+)(px|rem)$/i
  const number = /^(?:\d+(?:\.\d+)?|\.\d+)$/
  const family = /^(?:"[^"\r\n\\{};]+"|'[^'\r\n\\{};]+'|[\p{L}\p{N}_-]+(?: +[\p{L}\p{N}_-]+)*)(?: *, *(?:"[^"\r\n\\{};]+"|'[^'\r\n\\{};]+'|[\p{L}\p{N}_-]+(?: +[\p{L}\p{N}_-]+)*))*$/u
  const style = document.createElement('span').style

  ui.textStyleProperties = properties
  ui.supportsTextStyle = node => Array.from(node.children).every(child =>
    !child.textContent.trim() || child.matches('svg,script,style,template,[hidden]') ||
    getComputedStyle(child).display === 'none',
  )
  ui.textStyleReference = (name, property, fallback) =>
    'var(' + name + '-' + property + (fallback === undefined ? '' : ', ' + fallback) + ')'

  ui.captureTextStyle = node => {
    if (!node?.isConnected || !ui.supportsTextStyle(node)) return null
    const computed = getComputedStyle(node)
    const values = Object.fromEntries(properties.map(property => [property, computed.getPropertyValue(property).trim()]))
    if (Object.values(values).some(value => !value || value.length > 100) ||
        !family.test(values['font-family']) || !number.test(values['font-weight']) ||
        Number(values['font-weight']) < 1 || Number(values['font-weight']) > 1000) return null
    for (const property of properties.slice(2)) {
      const value = values[property]
      if (value === 'normal' && property !== 'font-size') continue
      const pixels = parseFloat(value)
      if (length.exec(value)?.[1] !== 'px' || Math.abs(pixels) > 2000 ||
          (pixels < 0 && property !== 'letter-spacing')) return null
    }
    return values
  }

  ui.textStyleValues = (node, name) => {
    if (!namePattern.test(name)) return null
    const computed = getComputedStyle(node)
    const values = {}
    for (const property of properties) {
      const value = computed.getPropertyValue(name + '-' + property).trim()
      if (!value || value.length > 100 || !CSS.supports(property, value)) return null
      values[property] = value
    }
    if (!family.test(values['font-family']) || /^(inherit|initial|unset|revert|revert-layer)$/i.test(values['font-family'])) return null
    style.fontFamily = values['font-family']
    values['font-family'] = style.fontFamily
    const weight = values['font-weight'].toLowerCase()
    if (weight === 'normal' || weight === 'bold') values['font-weight'] = weight === 'normal' ? '400' : '700'
    else if (number.test(weight) && Number(weight) >= 1 && Number(weight) <= 1000) values['font-weight'] = String(Number(weight))
    else return null
    for (const property of properties.slice(2)) {
      const value = values[property].toLowerCase()
      if (value === 'normal' && property !== 'font-size') continue
      const unit = length.exec(value)?.[1]
      const amount = parseFloat(value)
      if (!unit && value !== '0' && !(property === 'line-height' && number.test(value))) return null
      const pixels = unit === 'rem' ? amount * parseFloat(getComputedStyle(node.ownerDocument.documentElement).fontSize)
        : unit || property !== 'line-height' ? amount : amount * parseFloat(values['font-size'])
      if (!Number.isFinite(pixels) || Math.abs(pixels) > 2000 || (pixels < 0 && property !== 'letter-spacing')) return null
      values[property] = Number(pixels.toFixed(5)) + 'px'
    }
    return values
  }

  ui.textStyleMatches = (observed, expected) => observed === expected ||
    (observed.endsWith('px') && expected?.endsWith('px') &&
      Math.abs(parseFloat(observed) - parseFloat(expected)) <= Math.max(0.0001, Math.abs(parseFloat(expected)) * 0.000005))

  ui.textStyleName = (node, catalog) => {
    if (!catalog) return null
    const name = catalog.names.find(name => properties.every(property =>
      node.style.getPropertyValue(property) === ui.textStyleReference(name, property),
    ))
    const values = name && ui.textStyleValues(node, name)
    const computed = values && getComputedStyle(node)
    return computed && properties.every(property => ui.textStyleMatches(computed.getPropertyValue(property), values[property]))
      ? name : null
  }
})()
