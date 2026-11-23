(() => {
  const ui = window.LocalhostInspector

  function sample(value, text) {
    const glyph = ui.element('span', '', text)
    for (const key of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'lineHeight', 'letterSpacing']) {
      if (value[key]) glyph.style[key] = value[key]
    }
    return glyph
  }

  // Measure the rendered font. A late-loading face or a resized inspector can
  // change which specimen fits without changing the audited measurements.
  function fitSpecimen(box, value, tile = false) {
    box.classList.add('li-fit-specimen')
    const short = sample(value, 'Ag')
    const long = tile ? null : sample(value, 'Rag 123')
    const marker = tile ? ui.element('sup', 'li-specimen-marker', '*') : null
    box.append(short)
    if (long) box.append(long)
    if (marker) box.append(marker)
    const observer = new ResizeObserver(() => {
      const width = box.clientWidth - 4
      const height = box.clientHeight - 4
      if (width <= 0 || height <= 0) return
      const useLong = long && long.offsetWidth <= width && long.offsetHeight <= height
      const glyph = useLong ? long : short
      const fits = glyph.offsetWidth <= width && glyph.offsetHeight <= height
      const markerWidth = marker && !fits ? marker.offsetWidth : 0
      const scale = Math.min(1, (width - markerWidth) / Math.max(1, glyph.offsetWidth), height / Math.max(1, glyph.offsetHeight))
      short.style.visibility = useLong ? 'hidden' : 'visible'
      if (long) long.style.visibility = useLong ? 'visible' : 'hidden'
      glyph.style.transform = 'translate(-50%, -50%) translateX(' + (-markerWidth / 2) + 'px) scale(' + scale + ')'
      if (marker) {
        marker.style.visibility = fits ? 'hidden' : 'visible'
        marker.style.left = 'calc(50% + ' + ((glyph.offsetWidth * scale - markerWidth) / 2) + 'px)'
        marker.style.top = 'calc(50% - ' + glyph.offsetHeight * scale * 0.43 + 'px)'
        box.title = fits ? '' : 'Preview reduced to fit. Actual size ' + value.fontSize + '.'
      }
    })
    for (const target of [box, short, long].filter(Boolean)) observer.observe(target)
  }

  ui.typographyInventoryRow = (entry, count, family, openOccurrences, openDetails, jump) => {
    const value = entry.value
    const label = entry.name || [ui.weightName(value.fontWeight), value.fontStyle !== 'normal' && value.fontStyle].filter(Boolean).join(' ')
    const row = ui.element('div', 'li-type-row')
    row.dataset.entryId = entry.id
    const body = ui.element(openOccurrences ? 'button' : 'div', 'li-type-body')
    if (openOccurrences) {
      body.type = 'button'
      body.onclick = openOccurrences
    }
    const tile = ui.element('span', 'li-type-tile')
    tile.setAttribute('aria-hidden', 'true')
    fitSpecimen(tile, value, true)
    const labels = ui.element('span', 'li-type-labels')
    const metrics = [value.fontSize, value.lineHeight].map(n => n?.replace(/px$/, '')).join('/')
    const title = ui.element(openDetails ? 'h2' : 'span', '', label)
    const subtitle = openDetails ? (entry.name ? 'Styled' : 'Unstyled') : family + ' · ' + metrics
    labels.append(title, ui.element('span', 'li-var-meta', subtitle))
    body.append(tile, labels)
    if (!openDetails) body.append(count)
    row.append(body)
    if (openDetails) {
      const button = ui.action('View typography details for ' + label, 'launcherSliders', () => openDetails(button))
      button.classList.add('li-type-action', 'li-layout-settings-trigger')
      button.setAttribute('aria-haspopup', 'dialog')
      button.setAttribute('aria-expanded', 'false')
      if (jump) row.append(jump)
      row.append(button)
    }
    return row
  }

  ui.typeUsesList = ({ entry, pages, scopedPage, expanded, countLabel, occurrenceRow, reveal, previewText, selectText }) => {
    const element = ui.element('section', 'li-type-uses')
    const toolbar = ui.element('div', 'li-type-use-toolbar')
    const byPage = new Map()
    for (const hit of entry.occurrences) {
      if (scopedPage !== null && hit.pageId !== scopedPage) continue
      if (!byPage.has(hit.pageId)) byPage.set(hit.pageId, [])
      byPage.get(hit.pageId).push(hit)
    }
    const ordered = pages.flatMap(page => byPage.get(page.id) ?? [])
    let index = -1
    let stepping = false
    async function stepTo(hit) {
      if (!hit || stepping) return
      stepping = true
      try { await reveal(hit) }
      finally { stepping = false }
    }
    const text = entry.category === 'typography'
    let all
    toolbar.classList.add('li-text-uses-header')
    element.append(toolbar)
    if (text && scopedPage !== null) {
      all = ui.element('button', 'li-all-text', 'All text')
      all.type = 'button'
      all.disabled = !ordered.length
      all.append(countLabel(ordered.length))
      all.onclick = () => selectText(ordered)
      all.onpointerenter = () => previewText(ordered)
      all.onpointerleave = () => previewText([])
      toolbar.append(all)
    } else toolbar.append(ui.element('h3', '', text ? 'All text' : 'Instances'), countLabel(ordered.length))
    element.setAttribute('aria-label', entry.category === 'component' ? 'Component instances' : 'Text uses')
    const groups = new Map()
    const rows = new Map()
    for (const page of pages) {
      const hits = byPage.get(page.id)
      if (!hits) continue
      let parent = element
      if (scopedPage === null) {
        const group = ui.sidebarDisclosure('', 'li-type-page', expanded.has(page.id))
        const summary = group.firstElementChild
        const label = ui.element('span', 'li-type-page-name', page.label)
        ui.setTooltip(summary, page.label)
        summary.append(ui.icon('frame'), label, countLabel(hits.length))
        group.ontoggle = () => {
          if (!element.isConnected) return
          if (group.open) expanded.add(page.id)
          else expanded.delete(page.id)
        }
        element.append(group)
        groups.set(page.id, group)
        parent = group
      }
      for (const hit of hits) {
        const row = occurrenceRow(hit)
        parent.append(row)
        rows.set(hit, row)
      }
    }
    if (!ordered.length) element.append(ui.element('p', 'li-var-message', 'No uses in this scope.'))
    element.onkeydown = event => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
          !['ArrowDown', 'ArrowUp'].includes(event.key) || !event.target.closest('.li-type-use')) return
      event.preventDefault()
      const row = event.target.closest('.li-type-use')
      const rowIndex = ordered.findIndex(hit => rows.get(hit) === row)
      const hit = ordered[rowIndex + (event.key === 'ArrowDown' ? 1 : -1)]
      void stepTo(hit)
    }
    function select(hit, scroll) {
      index = ordered.indexOf(hit)
      if (!scroll || index < 0) return
      const group = groups.get(hit.pageId)
      if (group) {
        expanded.add(hit.pageId)
        group.open = true
      }
      const row = rows.get(hit)
      row.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      if (element.getRootNode().activeElement?.closest('.li-type-use')) row.focus({ preventScroll: true })
    }
    function markSelection(nodes) {
      if (!text) return
      const selected = new Set(nodes)
      for (const [hit, row] of rows) {
        if (selected.has(hit.node)) row.setAttribute('aria-current', 'true')
        else row.removeAttribute('aria-current')
      }
      all?.setAttribute('aria-pressed', String(ordered.length > 0 && ordered.every(hit => selected.has(hit.node))))
    }
    return { element, select, markSelection }
  }

  ui.openInventoryTypeDetails = (anchor, entry, openCreate, finished, created) => {
    const { value, name } = entry
    const title = name || 'Typography details'
    const popup = ui.element('div', 'li-menu li-context-popup li-create-definition li-text-style-create')
    popup.setAttribute('role', 'dialog')
    popup.setAttribute('aria-label', title)
    const dismiss = ui.action('Close typography details', 'dismiss', () => close())
    const plus = ui.action('Create text style', 'add', () => openForm())
    const supported = value.fontStyle === 'normal' && ['normal', '100%'].includes(value.fontStretch)
    const actions = name ? [dismiss] : [plus, dismiss]
    if (!name && (!openCreate || !supported)) {
      const reason = !supported ? 'This font style or stretch cannot be saved as a text style yet.' :
        'Style creation requires an attached, up-to-date Inspector and a writable text style source.'
      plus.setAttribute('aria-disabled', 'true')
      plus.setAttribute('aria-description', reason)
      ui.setTooltip(plus, reason)
      plus.onclick = () => {}
    }
    const specimen = ui.element('div', 'li-text-style-specimen')
    specimen.style.setProperty('--li-specimen-size', value.fontSize)
    fitSpecimen(specimen, value)
    const properties = ui.element('dl', 'li-text-style-properties li-type-properties')
    for (const [label, content] of [['Family', value.fontFamily], ['Style', value.fontStyle], ['Weight', ui.weightName(value.fontWeight) !== value.fontWeight ? ui.weightName(value.fontWeight) + ' (' + value.fontWeight + ')' : value.fontWeight],
      ['Size', value.fontSize], ['Line height', value.lineHeight], ['Letter spacing', value.letterSpacing]]) {
      const pair = ui.element('div')
      pair.append(ui.element('dt', '', label), ui.element('dd', '', content))
      properties.append(pair)
    }
    popup.append(ui.popupHeader(title, ...actions), specimen, properties)
    const besideRow = () => {
      const rect = anchor.closest('.li-type-row').getBoundingClientRect()
      return [rect.right + 8, rect.top]
    }
    const mount = panel => ui.mountPopup(anchor, panel, besideRow, { trackSize: true, onClose: () => { if (!switching) finished() } })
    let switching = false
    let close
    function showDetails() {
      close = mount(popup)
      dismiss.focus({ preventScroll: true })
    }
    function openForm() {
      switching = true
      close(false)
      switching = false
      const closeForm = openCreate(entry, anchor, () => {
        showDetails()
        plus.focus({ preventScroll: true })
      }, () => { finished(); created() }, finished)
      if (closeForm) close = closeForm
      else showDetails()
    }
    popup.onkeydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
    }
    showDetails()
    return () => close(false)
  }
})()
