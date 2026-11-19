(() => {
  const ui = window.LocalhostInspector
  const categories = { typography: 'Typography', color: 'Color', spacing: 'Spacing' }
  const scopeLabels = { typography: 'All type', color: 'All colors', spacing: 'All spacing' }
  const allLabels = { ...scopeLabels, typography: 'All typography' }
  const colorProperties = { color: 'Text', 'background-color': 'Fill', 'border-color': 'Border', 'placeholder-color': 'Placeholder' }
  const weightNames = { 100: 'Thin', 200: 'Extra light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black' }

  function control(className, handler, label) {
    const button = ui.element('button', 'li-var-control ' + className, label)
    button.type = 'button'
    button.onclick = handler
    return button
  }

  function countLabel(count) {
    const label = ui.element('span', 'li-var-count', String(count))
    label.setAttribute('aria-label', count + (count === 1 ? ' use' : ' uses'))
    return label
  }

  function familyNames(stack = '') {
    return (stack.match(/"[^"]*"|'[^']*'|[^,]+/g) || [])
      .map(name => name.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
  }

  function shareSpecimenFonts(entries, appDocument, destination, shared) {
    const families = new Set()
    const documents = new Set(appDocument ? [appDocument] : [])
    for (const entry of entries) {
      if (entry.category !== 'typography') continue
      for (const family of familyNames(entry.value.fontFamily)) families.add(family.toLowerCase())
      for (const hit of entry.occurrences) {
        if (hit.node?.isConnected) documents.add(hit.node.ownerDocument)
      }
    }
    const wanted = new Set()
    for (const doc of documents) {
      if (doc === destination) continue
      for (const face of doc.fonts) {
        if (families.has(face.family.replace(/^["']|["']$/g, '').toLowerCase())) wanted.add(face)
      }
    }
    for (const face of shared) {
      if (wanted.has(face)) continue
      destination.fonts.delete(face)
      shared.delete(face)
    }
    for (const face of wanted) {
      if (destination.fonts.has(face)) continue
      destination.fonts.add(face)
      shared.add(face)
    }
  }

  const characters = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

  function colorSpecimen(entry, hits, onOpen) {
    const row = onOpen ? control('li-var-color-row', onOpen) : ui.element('div', 'li-var-color-row')
    const field = ui.element('span', 'li-var-color-field')
    field.append(ui.colorSwatch(entry.value))
    if (entry.name) {
      const name = entry.name[0].toUpperCase() + entry.name.slice(1)
      field.classList.add('li-var-color-role')
      field.append(ui.element('span', 'li-var-color-name', name))
      if (onOpen) ui.setTooltip(row, name)
    } else {
      const [red, green, blue, alpha] = ui.colorChannels(entry.value)
      const hex = [red, green, blue].map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase()
      const opacity = Math.round(alpha / 255 * 100) + ' %'
      field.append(ui.element('span', 'li-var-color-name', hex), ui.element('span', 'li-var-opacity', opacity))
    }
    row.append(field)
    if (onOpen) row.append(countLabel(hits.length))
    return row
  }

  function colorTrailing(count, icon) {
    const trailing = ui.element('span', 'li-var-color-trailing')
    trailing.append(countLabel(count), ui.icon(icon))
    return trailing
  }

  function specimen(entry, hits, onOpen) {
    const row = onOpen ? control('li-var-value', onOpen) : ui.element('div', 'li-var-value')
    const line = ui.element('span', 'li-var-line')
    const sample = ui.element('span', 'li-var-sample')
    const value = entry.value
    let metadata
    if (entry.category === 'typography') {
      sample.textContent = entry.name || 'The quick brown fox'
      for (const prop of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'lineHeight', 'letterSpacing']) {
        if (value[prop]) sample.style[prop] = value[prop]
      }
      const family = familyNames(value.fontFamily)[0]
      const size = [value.fontSize, value.lineHeight].filter(Boolean).join(' / ')
      const weight = weightNames[value.fontWeight] || value.fontWeight
      const tracking = value.letterSpacing && value.letterSpacing !== 'normal' ? 'Tracking ' + value.letterSpacing : ''
      metadata = [family, size, weight, value.fontStyle !== 'normal' && value.fontStyle, tracking].filter(Boolean).join(' · ')
      sample.title = value.fontFamily || ''
    } else {
      sample.classList.add('li-var-distance')
      const ruler = ui.element('span', 'li-var-ruler')
      ruler.setAttribute('aria-hidden', 'true')
      if (/^\d*\.?\d+px$/.test(value)) ruler.style.width = value
      else ruler.hidden = true
      sample.append(ui.element('span', '', entry.name || value), ruler)
      const properties = [...new Set(hits.map(hit => hit.property).filter(Boolean))].join(', ')
      metadata = [entry.name && value, properties].filter(Boolean).join(' · ')
    }
    line.append(sample, countLabel(hits.length))
    row.append(line)
    if (metadata) row.append(ui.element('span', 'li-var-meta', metadata))
    return row
  }

  ui.createVariablesPanel = ({ onReveal, onPage } = {}) => {
    const element = ui.element('section', 'li-variables')
    element.setAttribute('aria-label', 'Variables')
    const styles = ui.element('style', '', ui.variablesStyles)
    const body = ui.element('div', 'li-variables-body')
    const coverage = ui.element('p', 'li-var-message')
    const status = ui.element('p', 'li-var-message')
    status.setAttribute('role', 'status')
    element.append(styles, body, status, coverage)
    const sharedFonts = new Set()
    let inventory = { pages: [], entries: [] }
    let category = 'typography'
    let mode = 'all'
    let scopedPage = null
    let automaticScope = false
    let selectedEntry = null
    let resultPage = null
    let selectedHit = null
    let revealRequest = 0

    function clearDetails() {
      selectedEntry = resultPage = selectedHit = null
      revealRequest++
      status.textContent = ''
    }

    function navigate(change, focus = '.li-var-back') {
      status.textContent = ''
      change()
      render()
      body.scrollTop = 0
      body.querySelector(focus)?.focus({ preventScroll: true })
    }

    function back(label, handler) {
      const button = control('li-var-back', () => navigate(handler, '.li-var-control'))
      button.append(ui.icon('chevronRight'), ui.element('span', '', label))
      return button
    }

    function listRow(label, trailing, handler) {
      const row = control('li-var-list-row', handler)
      row.append(ui.element('span', '', label), trailing)
      return row
    }

    function header() {
      const top = ui.element('div', 'li-variables-header')
      const allScope = category === 'color' ? 'All screens' : scopeLabels[category]
      const options = [['all', allScope], ['screens', 'By screen']]
      const scope = control('li-var-quiet', () => ui.openMenu(scope, options, mode, value => {
        navigate(() => { mode = value; scopedPage = null; automaticScope = false; clearDetails() }, '.li-var-quiet')
      }, { label: 'Variable inventory scope', below: true }), mode === 'screens' ? 'By screen' : allScope)
      scope.setAttribute('aria-haspopup', 'menu')
      scope.setAttribute('aria-expanded', 'false')
      scope.append(ui.icon('chevronDown'))
      top.append(ui.element('h2', '', 'Variables'), scope)
      const tabs = ui.element('div', 'li-inspector-tabs')
      tabs.setAttribute('role', 'group')
      tabs.setAttribute('aria-label', 'Variable category')
      for (const [key, title] of Object.entries(categories)) {
        const tab = control('', () => navigate(() => { category = key; clearDetails() }, '[aria-pressed=true]'), title)
        tab.className = ''
        tab.setAttribute('aria-pressed', String(category === key))
        tabs.append(tab)
      }
      body.append(top, tabs)
    }

    function showInventory() {
      const rows = inventory.entries.filter(entry => entry.category === category).map(entry => ({
        entry, hits: scopedPage === null ? entry.occurrences : entry.occurrences.filter(hit => hit.pageId === scopedPage),
      })).filter(row => scopedPage === null || row.hits.length)
      if (!rows.length) body.append(ui.element('p', 'li-var-message', 'No ' + categories[category].toLowerCase() + ' found.'))
      if (category === 'color' && rows.length) {
        const group = ui.element('section', 'li-var-group li-var-color-group')
        group.append(ui.element('h3', '', 'Selection colors'))
        rows.sort((first, second) => Number(Boolean(second.entry.name)) - Number(Boolean(first.entry.name)))
        for (const { entry, hits } of rows) {
          group.append(colorSpecimen(entry, hits, () => navigate(() => { selectedEntry = entry })))
        }
        body.append(group)
        return
      }
      const groups = category === 'typography' ? ['Styled', 'Unstyled'] : ['Named spacing', 'Unnamed spacing']
      groups.forEach((label, index) => {
        const groupRows = rows.filter(({ entry }) => Boolean(entry.name) === (index === 0))
        if (!groupRows.length) return
        const group = ui.element('section', 'li-var-group')
        group.append(ui.element('h3', '', label))
        for (const { entry, hits } of groupRows) {
          group.append(specimen(entry, hits, () => navigate(() => { selectedEntry = entry })))
        }
        body.append(group)
      })
    }

    function showPages() {
      const list = ui.element('div', 'li-var-list')
      for (const page of inventory.pages) {
        list.append(listRow(page.label, ui.icon('chevronRight'), () => {
          navigate(() => { scopedPage = page.id })
          Promise.resolve(onPage?.(page.id)).catch(() => {
            if (scopedPage === page.id) status.textContent = 'This screen could not be opened.'
          })
        }))
      }
      if (!list.children.length) list.append(ui.element('p', 'li-var-message', 'No screens scanned yet.'))
      body.append(list)
    }

    async function reveal(hit, entry) {
      const request = ++revealRequest
      const isCurrent = () => request === revealRequest && !element.hidden
      status.textContent = ''
      try {
        const result = await onReveal?.(hit, entry, isCurrent)
        if (!isCurrent()) return
        if (result !== true) {
          status.textContent = typeof result === 'string' ? result : 'This occurrence is unavailable on the current screen.'
          return
        }
        const latest = inventory.entries.find(item => item.id === entry.id)
        selectedHit = ui.findVariableOccurrence(latest, hit)
        for (const item of body.querySelectorAll('[aria-current=true]')) item.removeAttribute('aria-current')
        occurrenceRows.get(selectedHit)?.setAttribute('aria-current', 'true')
      } catch {
        if (isCurrent()) status.textContent = 'This occurrence could not be opened.'
      }
    }

    const occurrenceRows = new Map()

    function occurrenceRow(hit, entry) {
      const row = control('li-var-list-row', () => reveal(hit, entry))
      let label = hit.label
      if (entry.category === 'color') {
        const parts = [...characters.segment(label)]
        if (parts.length > 16) label = label.slice(0, parts[16].index) + '…'
        ui.setTooltip(row, hit.label)
        row.setAttribute('aria-label', hit.label + ' ' + (colorProperties[hit.property] ?? hit.property))
      }
      row.append(ui.element('span', '', label))
      occurrenceRows.set(hit, row)
      if (selectedHit === hit) row.setAttribute('aria-current', 'true')
      return row
    }

    function showColorEntry(entry) {
      const pageUses = new Map()
      for (const hit of entry.occurrences) {
        if (scopedPage !== null && hit.pageId !== scopedPage) continue
        if (!pageUses.has(hit.pageId)) pageUses.set(hit.pageId, [])
        pageUses.get(hit.pageId).push(hit)
      }
      header()
      body.append(back('All colors', clearDetails))
      const detail = ui.element('div', 'li-var-color-detail')
      detail.append(colorSpecimen(entry), ui.element('h3', '', 'Occurrences by screen'))
      body.append(detail)
      const list = ui.element('div', 'li-var-list')
      for (const page of inventory.pages) {
        const pageHits = pageUses.get(page.id)
        if (!pageHits) continue
        const multiple = pageHits.length > 1
        const expanded = multiple && resultPage === page.id
        const trailing = multiple ? colorTrailing(pageHits.length, expanded ? 'chevronDown' : 'chevronRight') : countLabel(pageHits.length)
        const row = listRow(page.label, trailing, () => {
          if (!multiple) { void reveal(pageHits[0], entry); return }
          resultPage = expanded ? null : page.id
          revealRequest++
          status.textContent = ''
          render()
          body.querySelector('[data-color-page="' + CSS.escape(page.id) + '"]')?.focus({ preventScroll: true })
        })
        row.dataset.colorPage = page.id
        row.classList.add('li-var-color-page')
        if (multiple) row.setAttribute('aria-expanded', String(expanded))
        else {
          occurrenceRows.set(pageHits[0], row)
          if (selectedHit === pageHits[0]) row.setAttribute('aria-current', 'true')
        }
        list.append(row)
        if (expanded) {
          for (const hit of pageHits) {
            const use = occurrenceRow(hit, entry)
            use.classList.add('li-var-color-use')
            use.append(ui.element('span', 'li-var-use-property', colorProperties[hit.property] ?? hit.property))
            list.append(use)
          }
        }
      }
      if (!list.children.length) list.append(ui.element('p', 'li-var-message', 'No occurrences on scanned screens.'))
      body.append(list)
    }

    function showEntry(entry) {
      const pageId = resultPage ?? scopedPage
      const hits = pageId === null ? entry.occurrences : entry.occurrences.filter(hit => hit.pageId === pageId)
      const pageLabel = id => inventory.pages.find(page => page.id === id)?.label
      const backLabel = resultPage !== null ? 'Screen list' : (pageLabel(scopedPage) || allLabels[category])
      body.append(back(backLabel, () => {
        if (resultPage !== null) { resultPage = selectedHit = null; revealRequest++ }
        else clearDetails()
      }))
      const summary = ui.element('div', 'li-var-detail')
      summary.append(specimen(entry, hits))
      body.append(summary)
      const list = ui.element('div', 'li-var-list')
      if (pageId !== null) {
        for (const hit of hits) {
          const row = occurrenceRow(hit, entry)
          const label = row.firstElementChild
          if (hit.property && entry.category !== 'typography') label.append(ui.element('span', 'li-var-meta', hit.property))
          list.append(row)
        }
      } else {
        const counts = new Map()
        for (const hit of hits) counts.set(hit.pageId, (counts.get(hit.pageId) || 0) + 1)
        for (const page of inventory.pages) {
          if (!counts.has(page.id)) continue
          list.append(listRow(page.label, countLabel(counts.get(page.id)), () => {
            navigate(() => { resultPage = page.id })
            const first = body.querySelector('.li-var-list-row')
            if (first) first.click()
          }))
        }
      }
      if (!list.children.length) list.append(ui.element('p', 'li-var-message', 'No occurrences on scanned screens.'))
      body.append(list)
    }

    function render() {
      body.replaceChildren()
      occurrenceRows.clear()
      const entry = inventory.entries.find(item => item.id === selectedEntry?.id) ??
        (selectedEntry?.category === 'color' ? { ...selectedEntry, occurrences: [] } : null)
      if (entry) {
        if (entry.category === 'color') showColorEntry(entry)
        else showEntry(entry)
        return
      }
      if (selectedEntry !== null) clearDetails()
      if (scopedPage !== null) {
        const page = inventory.pages.find(page => page.id === scopedPage)
        if (automaticScope) header()
        else body.append(back('All screens', () => { scopedPage = null; mode = 'screens' }))
        if (!page) { body.append(ui.element('p', 'li-var-message', 'Waiting for this screen.')); return }
        body.append(ui.element('h2', 'li-var-detail-title', page.label))
        showInventory()
        return
      }
      header()
      if (mode === 'screens') showPages()
      else showInventory()
    }

    function setScope(pageId) {
      scopedPage = pageId ?? null
      automaticScope = scopedPage !== null
      mode = scopedPage === null ? 'all' : 'screens'
      clearDetails()
      render()
    }

    render()
    return {
      element, setScope,
      update(data, options = {}) {
        const active = element.getRootNode().activeElement
        const restoreFocus = body.contains(active) ? active.textContent : null
        inventory = data
        if (selectedHit && ui.findVariableOccurrence) {
          const entry = data.entries.find(item => item.id === selectedEntry?.id)
          selectedHit = ui.findVariableOccurrence(entry, selectedHit)
        }
        shareSpecimenFonts(data.entries, options.fontDocument, element.ownerDocument, sharedFonts)
        if (Object.hasOwn(options, 'pageId')) setScope(options.pageId)
        else render()
        if (restoreFocus !== null) {
          const buttons = body.querySelectorAll('button')
          const matching = [...buttons].filter(button => button.textContent === restoreFocus)
          if (matching.length === 1) matching[0].focus({ preventScroll: true })
        }
      },
      dispose() {
        for (const face of sharedFonts) element.ownerDocument.fonts.delete(face)
        sharedFonts.clear()
      },
      setCoverage(message) { coverage.textContent = message || '' },
    }
  }
})()
