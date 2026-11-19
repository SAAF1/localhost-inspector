(() => {
  const ui = window.LocalhostInspector
  const plainSelector = /^(?:[.#](?:[\w-]|\\.)+|[a-z][\w-]*|\*)$/i
  const simpleCompound = /^(?:[a-z][\w-]*|\*)?(?:[.#][\w-]+)*$/i
  const documentPath = location.pathname
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
    function walk(items, layer, uncertain, source, path, ownerPath) {
      const occurrences = new Map()
      function childPath(kind, label) {
        const key = JSON.stringify([kind, label])
        const ordinal = occurrences.get(key) ?? 0
        occurrences.set(key, ordinal + 1)
        return [...ownerPath, [kind, label, ordinal]]
      }
      for (const [index, rule] of Array.from(items).entries()) {
        const rulePath = [...path, index]
        const kind = rule.constructor.name
        if (kind === 'CSSLayerStatementRule') {
          for (const name of rule.nameList) rank(name)
        } else if (kind === 'CSSLayerBlockRule') {
          walk(rule.cssRules, rank(rule.name || Symbol()), uncertain || layer !== null, source, [...rulePath, ['layer', rule.name]], childPath(kind, rule.name))
        } else if (kind === 'CSSMediaRule') {
          if (doc.defaultView.matchMedia(rule.conditionText).matches) {
            walk(rule.cssRules, layer, uncertain, source, [...rulePath, ['media', rule.conditionText]], childPath(kind, rule.conditionText))
          }
        } else if (kind === 'CSSSupportsRule') {
          if (CSS.supports(rule.conditionText)) walk(rule.cssRules, layer, uncertain, source, [...rulePath, ['supports', rule.conditionText]], childPath(kind, rule.conditionText))
        } else if (kind === 'CSSImportRule') {
          const importPath = childPath(kind, [rule.href, rule.layerName, rule.media.mediaText, rule.supportsText])
          if (rule.styleSheet && doc.defaultView.matchMedia(rule.media.mediaText || 'all').matches &&
              (!rule.supportsText || CSS.supports(rule.supportsText))) {
            visit(rule.styleSheet, rule.layerName == null ? layer : rank(rule.layerName || Symbol()),
              [source, rulePath, rule.styleSheet.href, rule.layerName, rule.media.mediaText, rule.supportsText], importPath)
          }
        } else if (kind === 'CSSStyleRule') {
          rules.push({ rule, layer, source, rulePath, ownerPath: childPath(kind, rule.selectorText), uncertain: uncertain || Boolean(rule.cssRules?.length) })
        } else if (rule.cssRules && !['CSSKeyframesRule', 'CSSStartingStyleRule'].includes(kind)) {
          walk(rule.cssRules, layer, true, source, rulePath, childPath(kind, null))
        }
      }
    }
    function visit(sheet, layer, source, ownerPath = [source]) {
      if (sheet.disabled || !doc.defaultView.matchMedia(sheet.media?.mediaText || 'all').matches) return
      try { walk(sheet.cssRules, layer, false, source, [], ownerPath) }
      catch { readable = false }
    }
    const duplicates = new Map()
    for (const sheet of [...doc.styleSheets, ...doc.adoptedStyleSheets]) {
      const key = sheet.href ?? documentPath
      const index = duplicates.get(key) ?? 0
      duplicates.set(key, index + 1)
      visit(sheet, null, [sheet.href ? 'external' : 'inline', key, index])
    }
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

  function declaration(style, names, ignoreExpandedShorthands) {
    const values = names.flatMap(name => {
      if (ignoreExpandedShorthands &&
          ((name === 'padding' && style.getPropertyValue(names[0])) ||
          ((name === 'padding-block' || name === 'padding-inline') &&
            names.some(side => side.startsWith(name + '-') && style.getPropertyValue(side))))) return []
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

  function specificity(selector) {
    if (!simpleCompound.test(selector)) return null
    return [(selector.match(/#/g) ?? []).length, (selector.match(/\./g) ?? []).length, Number(/^[a-z]/i.test(selector))]
  }

  function strongestRule(winners) {
    if (winners.every(entry => entry.selector === winners[0].selector)) return winners.at(-1)
    const scores = winners.map(entry => specificity(entry.selector))
    if (scores.some(score => !score)) return null
    let winner = 0
    for (let index = 1; index < scores.length; index++) {
      const score = scores[index]
      const best = scores[winner]
      const different = score.findIndex((value, part) => value !== best[part])
      if (different === -1 || score[different] > best[different]) winner = index
    }
    return winners[winner]
  }

  function localDeclaration(node, property, forTemplate = false, originalInline, positional = false) {
    const names = declarationNames(node, property)
    const shorthand = /^(?:font-|line-height$)/.test(property) ? 'font'
      : property === 'background-color' ? 'background' : property === 'border-color' ? 'border' : null
    const inline = originalInline
      ? originalInline.value && { value: originalInline.value, important: originalInline.priority === 'important' }
      : declaration(node.style, names, forTemplate)
    // A renderer can write equal inline values from independent component settings.
    const inlineValue = () => forTemplate || inline?.uncertain ? null : inline?.value
    if (inline?.important) return inlineValue()
    const entries = candidates(node)
    if (!entries || entries.some(({ rule }) => rule.cssRules?.length)) return !forTemplate && inline && !inline.uncertain ? inline.value : null
    const values = entries.flatMap(({ rule, layer, uncertain, source, rulePath, ownerPath }) => {
      const entry = declaration(rule.style, names, forTemplate)
      if (!entry && (!shorthand || !rule.style.getPropertyValue(shorthand))) return []
      if (!entry) return [{ important: rule.style.getPropertyPriority(shorthand) === 'important', uncertain: true }]
      const rank = layer ?? Number.POSITIVE_INFINITY
      return [{ value: entry.value, selector: rule.selectorText, important: entry.important,
        rank: entry.important ? -rank : rank, uncertain: uncertain || entry.uncertain, source, rulePath, ownerPath }]
    })
    const important = values.some(entry => entry.important)
    if (inline && !important) return inlineValue()
    if (!values.length) return undefined
    if (values.some(entry => entry.uncertain)) return null
    const rank = Math.max(...values.filter(entry => entry.important === important).map(entry => entry.rank))
    const winners = values.filter(entry => entry.important === important && entry.rank === rank)
    if (forTemplate) {
      const winner = strongestRule(winners)
      if (!winner || /^(?:inherit|unset|revert|revert-layer|currentcolor)$/i.test(winner.value)) return null
      const path = positional ? [winner.source, winner.rulePath] : [winner.ownerPath]
      return JSON.stringify([...path, winner.selector, winner.value, winner.important])
    }
    if (winners.every(entry => entry.value === winners[0].value)) return winners[0].value
    const selectors = winners.map(entry => entry.selector)
    if (selectors.every(selector => selector === selectors[0]) || selectors.every(selector =>
      plainSelector.test(selector) && /[.#*]/.test(selector[0]) && selector[0] === selectors[0][0],
    )) return winners.at(-1).value
    return null
  }

  function propertySource(node, property) {
    for (let current = node; current; current = current.parentElement) {
      const value = localDeclaration(current, property)
      const keyword = value?.toLowerCase()
      if (keyword === 'inherit' || (property === 'color' && keyword === 'currentcolor')) continue
      if (inherited.test(property) && (value === undefined || keyword === 'unset')) continue
      return value ?? null
    }
    return null
  }

  ui.authoredProperty = (node, property) => node.getRootNode() === node.ownerDocument
    ? propertySource(node, property) : node.style.getPropertyValue(property) || null
  ui.authoredTemplateSource = (node, property, originalInline, positional) => {
    if (node.getRootNode() !== node.ownerDocument) return null
    // Only a declaration owned by this template part establishes a shared edit scope.
    return localDeclaration(node, property, true, originalInline(node), positional) ?? null
  }
})()
