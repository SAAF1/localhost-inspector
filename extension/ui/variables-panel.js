(() => {
  const ui = window.LocalhostInspector
  const categories = { typography: 'Typography', color: 'Color', spacing: 'Spacing' }
  const colorProperties = { color: 'Text', 'background-color': 'Fill', 'border-color': 'Border', 'placeholder-color': 'Placeholder' }

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

  // Oklab brings lightness and hue differences onto a comparable scale.
  function colorPoint([red, green, blue, alpha]) {
    const [r, g, b] = [red, green, blue].map(byte => {
      const v = byte / 255
      return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    })
    const l = Math.cbrt(0.4122214708*r + 0.5363325363*g + 0.0514459929*b)
    const m = Math.cbrt(0.2119034982*r + 0.6806995451*g + 0.1073969566*b)
    const s = Math.cbrt(0.0883024619*r + 0.2817188376*g + 0.6299787005*b)
    return [0.2104542553*l + 0.793617785*m - 0.0040720468*s,
      1.9779984951*l - 2.428592205*m + 0.4505937099*s,
      0.0259040371*l + 0.7827717662*m - 0.808675766*s, alpha / 255 * 0.02]
  }

  function orderedColors(rows, order) {
    const swatches = rows.map(row => {
      const rgba = ui.colorChannels(row.entry.value)
      const hex = rgba.slice(0, 3).map(n => n.toString(16).padStart(2, '0')).join('')
      return { row, point: colorPoint(rgba), label: row.entry.name || hex, rgba: rgba.join(',') }
    })
    swatches.sort((a, b) => Number(Boolean(b.row.entry.name)) - Number(Boolean(a.row.entry.name)) ||
      a.label.localeCompare(b.label) || a.row.entry.id.localeCompare(b.row.entry.id))
    if (order === 'name') return swatches
    const result = []
    let from = [1, 0, 0, 0.02] // Start at opaque white, then walk to the nearest remaining swatch.
    while (swatches.length) {
      let nearest = 0
      let best = Infinity
      for (let i = 0; i < swatches.length; i++) {
        const point = swatches[i].point
        const distance = point.reduce((sum, channel, j) => sum + (channel - from[j]) ** 2, 0)
        if (distance < best) { nearest = i; best = distance }
        if (best === 0) break
      }
      const [next] = swatches.splice(nearest, 1)
      result.push(next)
      from = next.point
    }
    return result
  }

  function colorValueLabel(value) {
    const [red, green, blue, alpha] = ui.colorChannels(value)
    const hex = '#' + [red, green, blue].map(channel => channel.toString(16).padStart(2, '0')).join('').toUpperCase()
    return alpha === 255 ? hex : hex + ' · ' + Math.round(alpha / 255 * 100) + '%'
  }

  function colorSpecimen(entry, hits, onOpen) {
    const row = onOpen ? control('li-var-color-row', onOpen) : ui.element('div', 'li-var-color-row')
    const name = entry.name ? entry.name[0].toUpperCase() + entry.name.slice(1) : 'Unnamed color'
    const labels = ui.element('span', 'li-type-labels')
    const role = ui.element('span', entry.name ? '' : 'li-var-color-unnamed', name)
    labels.append(role, ui.element('span', 'li-var-meta', colorValueLabel(entry.value)))
    row.append(ui.colorSwatch(entry.value), labels)
    if (onOpen && entry.name) ui.setTooltip(row, name)
    if (onOpen) row.append(countLabel(hits.length))
    return row
  }

  function colorTrailing(count, icon) {
    const trailing = ui.element('span', 'li-var-color-trailing')
    trailing.append(countLabel(count), ui.icon(icon))
    return trailing
  }

  function specimen(entry, hits, onOpen, openDetails) {
    if (entry.category === 'typography') return ui.typographyInventoryRow(entry, countLabel(hits.length), familyNames(entry.value.fontFamily)[0] || '', onOpen, openDetails)
    const row = onOpen ? control('li-var-value', onOpen) : ui.element('div', 'li-var-value')
    const line = ui.element('span', 'li-var-line')
    const value = entry.value
    const sample = ui.element('span', 'li-var-sample', entry.name || value)
    const properties = [...new Set(hits.map(hit => hit.property).filter(Boolean))].join(', ')
    const metadata = [entry.name && value, properties].filter(Boolean).join(' · ')
    line.append(sample, countLabel(hits.length))
    row.append(line)
    if (metadata) row.append(ui.element('span', 'li-var-meta', metadata))
    return row
  }

  ui.createVariablesPanel = ({ onReveal, onPage, currentPageId, onCreateTextStyle, onSpacingPreview, onColorPreview } = {}) => {
    const element = ui.element('section', 'li-variables')
    element.setAttribute('aria-label', 'Variables')
    const styles = ui.element('style', '', ui.variablesStyles)
    const body = ui.element('div', 'li-variables-body')
    body.addEventListener('keydown', event => {
      if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey || event.shiftKey ||
        !['ArrowUp', 'ArrowDown'].includes(event.key)) return
      const selector = '.li-color-matches > summary, button.li-var-color-row, button.li-var-value, button.li-type-body, button.li-var-list-row'
      const rows = [...body.querySelectorAll(selector)].filter(row =>
        !row.disabled && (row.matches('summary') || !row.closest('details:not([open])')) && row.getClientRects().length)
      if (!rows.length) return
      const target = event.target
      const current = target.closest(selector) ?? target.closest('.li-type-row')?.querySelector(selector)
      let index = rows.indexOf(current)
      const down = event.key === 'ArrowDown'
      if (index >= 0) index = Math.max(0, Math.min(rows.length - 1, index + (down ? 1 : -1)))
      else {
        const direction = down ? Node.DOCUMENT_POSITION_FOLLOWING : Node.DOCUMENT_POSITION_PRECEDING
        const candidates = down ? rows : rows.slice().reverse()
        const next = candidates.find(row => target.compareDocumentPosition(row) & direction)
        index = next ? rows.indexOf(next) : down ? 0 : rows.length - 1
      }
      event.preventDefault()
      rows[index].focus({ preventScroll: true })
      rows[index].scrollIntoView({ block: 'nearest', inline: 'nearest' })
    })
    const coverage = ui.element('p', 'li-var-message')
    const status = ui.element('p', 'li-var-message')
    status.setAttribute('role', 'status')
    element.append(styles, body, status, coverage)
    const collapsedGroups = new Set()
    const sharedFonts = new Set()
    let inventory = { pages: [], entries: [] }
    let category = 'typography'
    let colorOrder = 'similarity'
    let mode = 'all'
    let scopedPage = null
    let automaticScope = false
    let selectedEntry = null
    let resultPage = null
    let expandedTypePages = null
    let syncTypeSelection
    let selectedHit = null
    let revealRequest = 0

    let popup = null
    let popupEntry = null
    let canCreateTextStyle = false
    let refreshAfterClose = false
    function closePopup() { popup?.() }

    function openTypography(anchor, entry) {
      closePopup()
      popupEntry = entry.id
      popup = ui.openInventoryTypeDetails(anchor, entry, canCreateTextStyle && onCreateTextStyle, () => {
        popup = popupEntry = null
        if (refreshAfterClose) {
          refreshAfterClose = false
          render()
          const next = body.querySelector('[data-entry-id="' + CSS.escape(entry.id) + '"] .li-type-action')
          if (next && body.isConnected) next.focus({ preventScroll: true })
        }
      }, () => { status.textContent = 'Text style created.' })
    }

    let pinnedEntry = null
    let stopPreview
    function preview(entry) {
      stopPreview?.()
      stopPreview = null
      onColorPreview?.(entry?.category === 'color' ? entry : null)
      if (entry?.category === 'spacing') stopPreview = onSpacingPreview?.(entry.occurrences.filter(hit => hit.pageId === scopedPage))
    }
    function clearPreview() {
      pinnedEntry = null
      preview(null)
    }
    function previewRow(entry, hits) {
      const wrapper = ui.element('div', 'li-type-row li-preview-row')
      const makeButton = entry.category === 'color' ? colorSpecimen : specimen
      const button = makeButton(entry, hits, () => {
        pinnedEntry = pinnedEntry === entry ? null : entry
        for (const item of body.querySelectorAll('.li-preview-row [aria-pressed]')) item.setAttribute('aria-pressed', 'false')
        button.setAttribute('aria-pressed', String(Boolean(pinnedEntry)))
        preview(pinnedEntry)
      })
      button.setAttribute('aria-pressed', String(pinnedEntry === entry))
      const open = ui.action('Open occurrences for ' + (entry.name || entry.value), 'openOccurrences', () => {
        clearPreview()
        navigate(() => { selectedEntry = entry })
      })
      open.classList.add('li-type-action', 'li-layout-settings-trigger')
      wrapper.append(button, open)
      wrapper.onpointerenter = () => preview(entry)
      wrapper.onpointerleave = () => preview(pinnedEntry)
      wrapper.onfocusin = event => { if (event.target.matches(':focus-visible')) preview(entry) }
      wrapper.onfocusout = event => { if (!wrapper.contains(event.relatedTarget)) preview(pinnedEntry) }
      return wrapper
    }

    function clearDetails() {
      clearPreview()
      closePopup()
      expandedTypePages = null
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

    function typeScopeTitle(detail = false) {
      const options = detail ? [['screens', 'This page'], ['all', 'All pages']] : [['screens', 'Text on this page'], ['all', 'Text on all pages']]
      const label = options.find(([key]) => key === mode)[1]
      const scope = control('li-var-quiet li-type-scope', () => ui.openMenu(scope, options, mode, value => {
        if (mode === value) return
        navigate(() => {
          closePopup()
          clearPreview()
          revealRequest++
          mode = value
          scopedPage = value === 'screens' ? currentPageId?.() ?? null : null
          automaticScope = scopedPage !== null
          resultPage = null
          if (scopedPage && selectedHit?.pageId !== scopedPage) selectedHit = null
          expandedTypePages = null
        }, '.li-type-scope')
      }, { label: 'Text scope', below: true }), label)
      scope.setAttribute('aria-haspopup', 'menu')
      scope.setAttribute('aria-expanded', 'false')
      scope.append(ui.icon('chevronDown'))
      if (detail) return scope
      const heading = ui.element('h2', 'li-type-scope-title')
      heading.append(scope)
      return heading
    }

    function inventoryScope() {
      const allScope = category === 'color' ? 'All screens' : 'All spacing'
      const options = [['all', allScope], ['screens', 'By screen']]
      const scope = control('li-var-quiet', () => ui.openMenu(scope, options, mode, value => {
        navigate(() => { mode = value; scopedPage = null; automaticScope = false; clearDetails() }, '.li-var-quiet')
      }, { label: 'Variable inventory scope', below: true }), mode === 'screens' ? 'By screen' : allScope)
      scope.setAttribute('aria-haspopup', 'menu')
      scope.setAttribute('aria-expanded', 'false')
      scope.append(ui.icon('chevronDown'))
      return scope
    }

    function header() {
      if (category !== 'typography') {
        const top = ui.element('div', 'li-variables-header')
        top.append(ui.element('h2', '', 'Variables'), inventoryScope())
        body.append(top)
      }
      const tabs = ui.element('div', 'li-inspector-tabs')
      tabs.setAttribute('role', 'group')
      tabs.setAttribute('aria-label', 'Variable category')
      for (const [key, title] of Object.entries(categories)) {
        const tab = control('', () => navigate(() => { category = key; clearDetails() }, '[aria-pressed=true]'), title)
        tab.className = ''
        tab.setAttribute('aria-pressed', String(category === key))
        tabs.append(tab)
      }
      body.append(tabs)
      if (category === 'typography') body.append(typeScopeTitle())
    }

    function showInventory() {
      const rows = inventory.entries.filter(entry => entry.category === category).map(entry => ({
        entry, hits: scopedPage === null ? entry.occurrences : entry.occurrences.filter(hit => hit.pageId === scopedPage),
      })).filter(row => scopedPage === null || row.hits.length)
      if (!rows.length) body.append(ui.element('p', 'li-var-message', 'No ' + categories[category].toLowerCase() + ' found.'))
      if (category === 'color' && rows.length) {
        const group = ui.element('section', 'li-var-group li-var-color-group')
        const heading = ui.element('div', 'li-color-order')
        const options = [['similarity', 'Similarity'], ['name', 'Name']]
        const label = options.find(([key]) => key === colorOrder)[1]
        const sort = control('li-var-quiet', () => ui.openMenu(sort, options, colorOrder, key => {
          navigate(() => { colorOrder = key }, '.li-color-order button')
        }, { label: 'Sort colors', below: true }), label)
        sort.setAttribute('aria-label', 'Sort colors by ' + label.toLowerCase())
        sort.setAttribute('aria-haspopup', 'menu')
        sort.setAttribute('aria-expanded', 'false')
        sort.append(ui.icon('chevronDown'))
        heading.append(ui.element('h3', '', 'Selection colors'), sort)
        group.append(heading)
        const swatches = orderedColors(rows, colorOrder)
        for (let start = 0; start < swatches.length;) {
          const { row, rgba } = swatches[start]
          let end = start + 1
          if (colorOrder === 'similarity' && row.entry.name) {
            while (end < swatches.length && swatches[end].rgba === rgba && swatches[end].row.entry.name) end++
          }
          let parent = group
          if (end - start > 1) {
            const key = 'color/' + rgba
            const details = ui.sidebarDisclosure('', 'li-color-matches', !collapsedGroups.has(key))
            details.firstElementChild.append(ui.colorSwatch(row.entry.value),
              ui.element('span', '', colorValueLabel(row.entry.value)),
              ui.element('span', 'li-color-role-count', (end - start) + ' roles'))
            details.ontoggle = () => {
              if (!body.contains(details)) return
              if (details.open) collapsedGroups.delete(key)
              else collapsedGroups.add(key)
            }
            group.append(details)
            parent = details
          }
          for (const { row: member } of swatches.slice(start, end)) parent.append(previewRow(member.entry, member.hits))
          start = end
        }
        body.append(group)
        return
      }
      const groups = ['Styled', 'Unstyled']
      groups.forEach((label, index) => {
        const groupRows = rows.filter(({ entry }) => Boolean(entry.name) === (index === 0))
        if (!groupRows.length) return
        const key = category + '/' + label
        const group = ui.sidebarDisclosure(label, 'li-var-group li-type-group', !collapsedGroups.has(key))
        group.ontoggle = () => {
          if (!body.contains(group)) return
          if (group.open) collapsedGroups.delete(key)
          else collapsedGroups.add(key)
        }
        for (const { entry, hits } of groupRows) {
          if (category === 'spacing' && scopedPage !== null) {
            group.append(previewRow(entry, hits))
            continue
          }
          group.append(specimen(entry, hits, () => navigate(() => { selectedEntry = entry })))
        }
        body.append(group)
      })
    }

    function showPages() {
      const list = ui.element('div', 'li-var-list')
      for (const page of inventory.pages) {
        list.append(listRow(page.label, ui.icon('chevronRight'), () => {
          navigate(() => { scopedPage = page.id }, category === 'typography' && !selectedEntry ? '.li-type-scope' : '.li-var-back')
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
        syncTypeSelection?.(selectedHit, true)
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
      if (entry.category === 'typography') {
        row.classList.add('li-type-use')
        row.prepend(ui.icon('textLayer'))
        ui.setTooltip(row, hit.label)
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

    function showTypeEntry(entry) {
      body.append(back('Typography', clearDetails))
      const header = ui.element('div', 'li-var-detail')
      header.append(specimen(entry, [], null, anchor => openTypography(anchor, entry)))
      body.append(header)
      expandedTypePages ??= new Set([selectedHit?.pageId ?? currentPageId?.()])
      const uses = ui.typeUsesList({
        entry, pages: inventory.pages, scopedPage, expanded: expandedTypePages, countLabel,
        scope: typeScopeTitle(true), occurrenceRow: hit => occurrenceRow(hit, entry),
        reveal: hit => reveal(hit, entry),
      })
      body.append(uses.element)
      syncTypeSelection = uses.select
      uses.select(selectedHit)
    }

    function showSpacingEntry(entry) {
      const pageId = resultPage
      const hits = pageId === null ? entry.occurrences : entry.occurrences.filter(hit => hit.pageId === pageId)
      const pageLabel = inventory.pages.find(page => page.id === scopedPage)?.label
      const backLabel = resultPage !== null ? 'Screen list' : pageLabel || 'All spacing'
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
          if (hit.property) label.append(ui.element('span', 'li-var-meta', hit.property))
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
      pinnedEntry = pinnedEntry && inventory.entries.find(entry => entry.id === pinnedEntry.id)
      preview(pinnedEntry)
      body.replaceChildren()
      occurrenceRows.clear()
      syncTypeSelection = null
      const entry = inventory.entries.find(item => item.id === selectedEntry?.id) ??
        (selectedEntry?.category === 'color' ? { ...selectedEntry, occurrences: [] } : null)
      if (entry && category === 'typography' && mode === 'screens' && scopedPage === null) {
        header()
        showPages()
        return
      }
      if (entry) {
        if (entry.category === 'color') showColorEntry(entry)
        else if (entry.category === 'typography') showTypeEntry(entry)
        else showSpacingEntry(entry)
        return
      }
      if (selectedEntry !== null) clearDetails()
      if (scopedPage !== null) {
        const page = inventory.pages.find(page => page.id === scopedPage)
        if (automaticScope || category === 'typography') header()
        else body.append(back('All screens', () => { clearPreview(); scopedPage = null; mode = 'screens' }))
        if (!page) { body.append(ui.element('p', 'li-var-message', 'Waiting for this screen.')); return }
        if (category !== 'typography') body.append(ui.element('h2', 'li-var-detail-title', page.label))
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
      element, setScope, closePopup, clearPreview,
      update(data, options = {}) {
        const active = element.getRootNode().activeElement
        const restoreFocus = body.contains(active) ? active.textContent : null
        inventory = data
        const nextCapability = options.canCreateTextStyle ?? canCreateTextStyle
        const capabilityChanged = nextCapability !== canCreateTextStyle
        canCreateTextStyle = nextCapability
        if (selectedHit && ui.findVariableOccurrence) {
          const entry = data.entries.find(item => item.id === selectedEntry?.id)
          selectedHit = ui.findVariableOccurrence(entry, selectedHit)
        }
        shareSpecimenFonts(data.entries, options.fontDocument, element.ownerDocument, sharedFonts)
        if (Object.hasOwn(options, 'pageId')) setScope(options.pageId)
        else if (popup && !capabilityChanged && data.entries.some(entry => entry.id === popupEntry)) {
          refreshAfterClose = true
          return
        } else {
          closePopup()
          render()
        }
        if (restoreFocus !== null) {
          const buttons = body.querySelectorAll('button, .li-color-matches > summary')
          const matching = [...buttons].filter(button => button.textContent === restoreFocus)
          if (matching.length === 1) matching[0].focus({ preventScroll: true })
        }
      },
      dispose() {
        clearPreview()
        closePopup()
        for (const face of sharedFonts) element.ownerDocument.fonts.delete(face)
        sharedFonts.clear()
      },
      setCoverage(message) { coverage.textContent = message || '' },
    }
  }
})()
