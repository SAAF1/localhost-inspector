(() => {
  const ui = window.LocalhostInspector
  const plainSelector = /^(?:[.#](?:[\w-]|\\.)+|[a-z][\w-]*|\*)$/i
  const inherited = /^(?:font-family|font-size|font-weight|line-height|letter-spacing|color)$/
  let documents = new WeakMap()
  let matched = new WeakMap()
  let scheduled = false

  function sourceRules(doc) {
    if (documents.has(doc)) return documents.get(doc)
    if (!scheduled) {
      scheduled = true
      queueMicrotask(() => {
        documents = new WeakMap()
        matched = new WeakMap()
        scheduled = false
      })
    }
    const rules = []
    const layers = new Map()
    let readable = true
    function rank(name) {
      if (!layers.has(name)) layers.set(name, layers.size)
      return layers.get(name)
    }
    function walk(items, layer, uncertain) {
      for (const rule of items) {
        const kind = rule.constructor.name
        if (kind === 'CSSLayerStatementRule') {
          for (const name of rule.nameList) rank(name)
        } else if (kind === 'CSSLayerBlockRule') {
          walk(rule.cssRules, rank(rule.name || Symbol()), uncertain || layer !== null)
        } else if (kind === 'CSSMediaRule') {
          if (doc.defaultView.matchMedia(rule.conditionText).matches) walk(rule.cssRules, layer, uncertain)
        } else if (kind === 'CSSSupportsRule') {
          if (CSS.supports(rule.conditionText)) walk(rule.cssRules, layer, uncertain)
        } else if (kind === 'CSSImportRule') {
          if (rule.styleSheet && doc.defaultView.matchMedia(rule.media.mediaText || 'all').matches) {
            visit(rule.styleSheet, rule.layerName == null ? layer : rank(rule.layerName || Symbol()))
          }
        } else if (kind === 'CSSStyleRule') {
          rules.push({ rule, layer, uncertain: uncertain || Boolean(rule.cssRules?.length) })
        } else if (rule.cssRules && !['CSSKeyframesRule', 'CSSStartingStyleRule'].includes(kind)) {
          walk(rule.cssRules, layer, true)
        }
      }
    }
    function visit(sheet, layer = null) {
      if (sheet.disabled || !doc.defaultView.matchMedia(sheet.media?.mediaText || 'all').matches) return
      try { walk(sheet.cssRules, layer, false) }
      catch { readable = false }
    }
    for (const sheet of [...doc.styleSheets, ...doc.adoptedStyleSheets]) visit(sheet)
    const result = readable ? rules : null
    documents.set(doc, result)
    return result
  }

  function candidates(node) {
    if (matched.has(node)) return matched.get(node)
    const rules = sourceRules(node.ownerDocument)
    const result = rules?.filter(({ rule }) => {
      try { return node.matches(rule.selectorText) }
      catch { return false }
    })
    matched.set(node, result)
    return result
  }

  function declaration(style, names) {
    const values = names.flatMap(name => {
      const value = style.getPropertyValue(name).trim()
      return value ? [{ value, important: style.getPropertyPriority(name) === 'important' }] : []
    })
    if (style.getPropertyValue('all')) return { value: '', important: style.getPropertyPriority('all') === 'important', uncertain: true }
    if (!values.length) return null
    const first = values[0]
    return { ...first, uncertain: values.some(entry => entry.value !== first.value || entry.important !== first.important) }
  }

  function declarationNames(node, property) {
    const side = /^padding-(top|right|bottom|left)$/.exec(property)?.[1]
    if (!side) return [property]
    const style = getComputedStyle(node)
    if (style.writingMode !== 'horizontal-tb') {
      return [property, 'padding', 'padding-block', 'padding-inline',
        'padding-block-start', 'padding-block-end', 'padding-inline-start', 'padding-inline-end']
    }
    const logical = side === 'top' ? 'block-start' : side === 'bottom' ? 'block-end' :
      (side === 'left') === (style.direction === 'ltr') ? 'inline-start' : 'inline-end'
    return [property, 'padding-' + logical, 'padding-' + logical.split('-')[0], 'padding']
  }

  function propertySource(node, property) {
    const names = declarationNames(node, property)
    const shorthand = /^(?:font-|line-height$)/.test(property) ? 'font'
      : property === 'background-color' ? 'background' : property === 'border-color' ? 'border' : null
    const inline = declaration(node.style, names)
    if (inline?.important) return inline.uncertain ? null : inline.value
    const entries = candidates(node)
    if (!entries) return inline && !inline.uncertain ? inline.value : null
    if (entries.some(({ rule }) => rule.cssRules?.length)) return inline && !inline.uncertain ? inline.value : null
    const values = entries.flatMap(({ rule, layer, uncertain }) => {
      const entry = declaration(rule.style, names)
      if (!entry && (!shorthand || !rule.style.getPropertyValue(shorthand))) return []
      if (!entry) return [{ important: rule.style.getPropertyPriority(shorthand) === 'important', uncertain: true }]
      const rank = layer ?? Number.POSITIVE_INFINITY
      return [{ value: entry.value, selector: rule.selectorText, important: entry.important,
        rank: entry.important ? -rank : rank, uncertain: uncertain || entry.uncertain }]
    })
    const important = values.some(entry => entry.important)
    if (inline && !important) return inline.uncertain ? null : inline.value
    if (!values.length) return inherited.test(property) && node.parentElement ? propertySource(node.parentElement, property) : null
    if (values.some(entry => entry.uncertain)) return null
    const rank = Math.max(...values.filter(entry => entry.important === important).map(entry => entry.rank))
    const winners = values.filter(entry => entry.important === important && entry.rank === rank)
    if (winners.every(entry => entry.value === winners[0].value)) return winners[0].value
    const selectors = winners.map(entry => entry.selector)
    if (selectors.every(selector => selector === selectors[0]) || selectors.every(selector =>
      plainSelector.test(selector) && /[.#*]/.test(selector[0]) && selector[0] === selectors[0][0],
    )) return winners.at(-1).value
    return null
  }

  ui.authoredProperty = (node, property) => node.getRootNode() === node.ownerDocument
    ? propertySource(node, property) : node.style.getPropertyValue(property) || null
})()
