(() => {
  const ui = window.LocalhostInspector ||= {}
  const sides = ['top', 'right', 'bottom', 'left']
  const ignore = 'script,style,template,noscript,head,#localhost-inspector,#localhost-inspector-outlines,#localhost-inspector-dock,#localhost-inspector-spacing-preview'
  const reference = /^var\(\s*(--[\w-]+)(?:\s*,[^)]*)?\s*\)$/
  const cssKeys = ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing']
  const jsKeys = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing']

  // Unbound swatches share the same identity as their displayed RGBA channels.
  // Cache by CSS spelling within one scan or inventory build.
  function rawColorId(value, cache) {
    if (!cache.has(value)) cache.set(value, JSON.stringify(['color', null, Array.from(ui.colorChannels(value))]))
    return cache.get(value)
  }

  function typography(css, fontStyle = 'normal', fontStretch = '100%') {
    return { ...Object.fromEntries(jsKeys.map((key, i) => [key, css[cssKeys[i]]])), fontStyle, fontStretch }
  }

  const styleLabel = id => id.replace(/^--(?:text-)?/, '').split('-').map(word =>
    word ? word[0].toUpperCase() + word.slice(1) : word).join(' ')
  const simpleLabel = id => id.replace(/^--(?:color-)?/, '')
  const compact = text => text.replace(/\s+/g, ' ').trim()

  function registeredDefinition(node) {
    if (!node.hasAttribute('data-inspector-component')) return null
    const descriptor = node.getAttribute('data-inspector-component-definition')
    if (!descriptor) return null
    try {
      const parts = JSON.parse(descriptor)
      if (!Array.isArray(parts)) return null
      if (parts.length === 2) {
        // Older registrations published only the name. Verify their live definition.
        const live = node[Symbol.for('localhost-inspector.component.v1')]?.inspect?.()
        if (!live?.slots?.length && !live?.properties?.length) return null
      } else if (!Number.isSafeInteger(parts[2]) || parts[2] < 1) return null
      const [library, name] = parts
      return typeof library === 'string' && typeof name === 'string' && name.trim() ?
        { library: library.trim(), name: name.trim() } : null
    } catch {
      return null
    }
  }

  ui.registeredComponentName = node => registeredDefinition(node)?.name

  function occurrenceLabel(node, text) {
    const accessible = node.getAttribute('aria-label') || node.getAttribute('alt')
    if (accessible || text) return compact(accessible || text).slice(0, 120)
    const heading = node.querySelector(':scope > :is(h1,h2,h3,h4,h5,h6,[role="heading"])')
    const child = heading || (node.matches('a,button,label,[role="button"],[role="link"]') ? node : null)
    if (child && !child.isContentEditable) {
      const label = compact(child.innerText || '')
      if (label) return label.slice(0, 120)
    }
    return node.getAttribute('data-slot') || node.getAttribute('role') || node.localName
  }

  function painted(color) {
    return color && color !== 'transparent' && !/^rgba\([^)]*,\s*0(?:\.0*)?\)$/.test(color) &&
      !/\/\s*0(?:\.0*)?%?\s*\)$/.test(color)
  }

  function identity(node, label) {
    const anchor = node.closest('[data-inspector-target],[id]')
    return JSON.stringify([node.localName, anchor?.getAttribute('data-inspector-target') || anchor?.id || '',
      node.getAttribute('role'), node.getAttribute('data-slot'), label])
  }

  // Scan an already-rendered app document. Never acquire focus, change a route,
  // mount application controls, or count screenshots as inspected documents.
  ui.scanVariablesPage = (doc, page, catalogs = {}, observeRoot, matchSourceSlots = false) => {
    const entries = new Map()
    if (!doc?.body || !doc.defaultView) return { page, entries: [] }
    const win = doc.defaultView
    const root = doc.documentElement
    const rawColors = new Map()
    function entry(category, token, name, value) {
      const id = category === 'color' && !token ? rawColorId(value, rawColors) : JSON.stringify([category, token || null, value])
      if (!entries.has(id)) entries.set(id, { id, category, name, value, occurrences: [] })
      return entries.get(id)
    }

    const sourceById = new Map()
    const sourceBySlot = new Map()
    for (const def of catalogs.componentCatalog?.definitions ?? []) {
      const item = entry('component', def.source, def.name, def.name)
      if (matchSourceSlots) for (const marker of def.markers ?? []) sourceBySlot.set(marker, item)
      item.source = def.source
      item.fields = def.fields
      item.unmapped = true
      sourceById.set(JSON.stringify([def.source, def.name]), item)
    }
    const definitions = []
    for (const name of catalogs.textStyleCatalog?.names ?? []) {
      const values = ui.textStyleValues(root, name)
      if (values) {
        definitions.push({ name, label: styleLabel(name), values })
        entry('typography', name, styleLabel(name), typography(values))
      }
    }
    for (const draft of catalogs.pendingTextStyles ?? []) {
      if (draft.source !== catalogs.textStyleCatalog?.source || definitions.some(item => item.name === draft.name)) continue
      if (!draft.values || !cssKeys.every(key => typeof draft.values[key] === 'string')) continue
      const label = draft.label || styleLabel(draft.name)
      definitions.push({ name: draft.name, label, values: draft.values, pending: true })
      entry('typography', draft.name, label, typography(draft.values))
    }
    const tokens = { color: new Map(), spacing: new Map() }
    const resolvers = {
      color: ui.resolveColorVariable,
      spacing: (node, name) => {
        const length = ui.resolveSpacingLength(node, name)
        return length === null ? null : length + 'px'
      },
    }
    for (const category of ['color', 'spacing']) {
      const catalog = category === 'color' ? catalogs.colorCatalog : catalogs.spacingCatalog
      for (const name of catalog?.names ?? []) {
        // Preserve roles even when the development build inlines their public alias.
        const alias = catalog.aliases?.[name]
        for (const key of new Set([name, alias].filter(Boolean))) {
          const names = tokens[category].get(key) ?? []
          names.push(name)
          tokens[category].set(key, names)
        }
        const value = resolvers[category](root, name) ?? (alias && resolvers[category](root, alias))
        if (value) entry(category, name, simpleLabel(name), value)
      }
    }

    function measured(category, node, property, value, declaration) {
      if (!tokens[category].size) return entry(category, null, undefined, value)
      const authored = reference.exec((declaration === undefined ? ui.auditDeclaration(node, property) : declaration) || '')?.[1]
      const names = tokens[category].get(authored)
      const name = names?.length === 1 && resolvers[category](node, authored) === value ? names[0] : null
      return entry(category, name, name ? simpleLabel(name) : undefined, value)
    }

    function spacing(node, property, value) {
      const computed = node.computedStyleMap?.().get(property)
      if (computed?.value === 'auto' || String(computed).includes('%')) return null
      const declaration = ui.auditDeclaration(node, property)
      // Viewport and container units resolve to px even in Typed OM.
      if (/(?:\d|\.)(?:[sld]?v(?:w|h|min|max|i|b)|cq(?:w|h|min|max|i|b))\b/i.test(declaration || '')) return null
      return measured('spacing', node, property, value, declaration)
    }

    function visit(node) {
      if (node.matches(ignore)) return
      const style = win.getComputedStyle(node)
      if (style.display === 'none' || style.opacity === '0' || style.contentVisibility === 'hidden') return
      const box = node.getBoundingClientRect()
      const clipped = style.position === 'absolute' && box.width <= 1 && box.height <= 1 &&
        (style.clip !== 'auto' || style.clipPath !== 'none')
      if (clipped) return
      if (style.visibility === 'visible' && (box.width > 0 && box.height > 0 || style.display === 'contents')) {
        const text = node.isContentEditable || node.localName === 'textarea' ? '' : compact(Array.from(node.childNodes).filter(child => child.nodeType === 3)
          .map(child => child.nodeValue).join(' '))
        // Never collect values typed into editable fields.
        const field = node.matches('textarea,input:not([type]),input:is([type=text],[type=search],[type=email],[type=tel],[type=url],[type=password],[type=number])')
        const placeholder = field && node.matches(':placeholder-shown')
        const controlText = node.matches('input[type=button],input[type=submit]') ? node.getAttribute('value') :
          placeholder ? node.placeholder : node.localName === 'select' ? node.selectedOptions?.[0]?.label : ''
        const label = occurrenceLabel(node, text || controlText)
        const key = identity(node, label)
        const add = (item, property, edges) => item.occurrences.push({
          pageId: page.id, label: label.slice(0, 120), property, node, key, ...(edges ? { edges } : {}),
        })
        const fromSource = node.hasAttribute('data-inspector-instance')
          ? sourceById.get(node.getAttribute('data-inspector-source')) : sourceBySlot.get(node.getAttribute('data-slot'))
        if (fromSource) fromSource.unmapped = false
        const definition = registeredDefinition(node)
        if (definition) {
          const { library, name } = definition
          const value = library ? name + ' · ' + library : name
          const item = fromSource?.name === name ? fromSource : entry('component', JSON.stringify(['definition', library, name]), name, value)
          add(item, 'component')
        } else if (fromSource) add(fromSource, 'component')
        if (text || controlText || (field && node.value)) {
          const textStyle = placeholder ? win.getComputedStyle(node, '::placeholder') : style
          const values = Object.fromEntries(cssKeys.map(key => [key, textStyle.getPropertyValue(key)]))
          const recipe = typography(values, textStyle.fontStyle, textStyle.fontStretch)
          let match
          if (!placeholder && textStyle.fontStyle === 'normal' && ['normal', '100%'].includes(textStyle.fontStretch)) {
            match = definitions.find(definition => {
              const expected = definition.pending ? definition.values : ui.textStyleValues(node, definition.name)
              return expected && cssKeys.every(key => ui.textStyleMatches(values[key], expected[key]) &&
                ui.hasTextStyleReference(node, definition.name, key, definition.pending ? expected[key] : undefined))
            })
          }
          add(entry('typography', match?.name, match?.label, recipe), 'typography')
          if (painted(textStyle.color)) {
            const item = placeholder ? entry('color', null, undefined, textStyle.color) :
              measured('color', node, 'color', textStyle.color)
            add(item, placeholder ? 'placeholder-color' : 'color')
          }
        }
        if (style.display !== 'contents') {
          if (painted(style.backgroundColor)) add(measured('color', node, 'background-color', style.backgroundColor), 'background-color')
          // Count identical sides once per box; retain the affected sides for inspection.
          const boxes = new Map()
          function group(item, property, edge) {
            const key = JSON.stringify([item.id, property])
            if (!boxes.has(key)) boxes.set(key, { item, property, edges: [] })
            boxes.get(key).edges.push(edge)
          }
          for (const side of sides) {
            for (const property of ['padding', 'margin']) {
              const longhand = property + '-' + side
              const value = style.getPropertyValue(longhand)
              if (!parseFloat(value)) continue
              // Typed OM retains auto and percentage values even when the legacy
              // computed style exposes only their used pixel measurements.
              const item = spacing(node, longhand, value)
              if (item) group(item, property, side)
            }
            const border = 'border-' + side
            if (parseFloat(style.getPropertyValue(border + '-width'))) {
              const property = border + '-color'
              const value = style.getPropertyValue(property)
              if (painted(value)) group(measured('color', node, property, value), 'border-color', side)
            }
          }
          if (/^(inline-)?(flex|grid)$/.test(style.display)) {
            for (const axis of ['row', 'column']) {
              const property = axis + '-gap'
              const value = style.getPropertyValue(property)
              if (!parseFloat(value)) continue
              const item = spacing(node, property, value)
              if (item) group(item, 'gap', axis)
            }
          }
          for (const { item, property, edges } of boxes.values()) add(item, property, edges)
        }
      }
      if (node.shadowRoot) {
        observeRoot?.(node.shadowRoot)
        for (const child of node.shadowRoot.children) visit(child)
      }
      for (const child of node.children) visit(child)
    }
    ui.withAuditRules(doc, () => visit(doc.body))
    for (const item of entries.values()) {
      const counts = new Map()
      for (const occurrence of item.occurrences) {
        const key = JSON.stringify([occurrence.property, occurrence.key])
        counts.set(key, (counts.get(key) || 0) + 1)
      }
      for (const occurrence of item.occurrences) {
        occurrence.unique = counts.get(JSON.stringify([occurrence.property, occurrence.key])) === 1
      }
    }
    return { page, entries: [...entries.values()], componentCoverage: 'configurable-definitions', verifiedComponentRoots: true, componentRevision: catalogs.componentCatalog?.revision }
  }

  ui.variablesInventory = (scans, componentRevision) => {
    // The latest scan replaces its previous counts after a route revisits.
    const latest = new Map(scans.map(scan => [scan.page.id, scan]))
    const entries = new Map()
    const rawColors = new Map()
    for (const scan of latest.values()) {
      for (const item of scan.entries) {
        // Older captures counted DOM part labels and registrations with no controls.
        if (item.category === 'component' && scan.componentCoverage !== 'configurable-definitions') continue
        if (item.source && item.category === 'component' && (!scan.verifiedComponentRoots ||
          (componentRevision && scan.componentRevision !== componentRevision))) continue
        // Older captures keyed raw colors by their original CSS spelling.
        const id = item.category === 'color' && !item.name ? rawColorId(item.value, rawColors) : item.id
        if (!entries.has(id)) entries.set(id, { ...item, id, occurrences: [] })
        const combined = entries.get(id)
        if (item.source && item.unmapped === false) combined.unmapped = false
        for (const occurrence of item.occurrences) combined.occurrences.push(occurrence)
      }
    }
    return { pages: [...latest.values()].map(scan => scan.page), entries: [...entries.values()] }
  }

  ui.findVariableOccurrence = (item, previous) => {
    const candidates = item?.occurrences.filter(hit => hit.pageId === previous.pageId && hit.property === previous.property) ?? []
    const live = candidates.find(hit => hit.node?.isConnected && hit.node === previous.node && hit.key === previous.key)
    if (live) return live
    if (!previous.unique) return null
    return candidates.find(hit => hit.unique && hit.key === previous.key) ?? null
  }
})()
