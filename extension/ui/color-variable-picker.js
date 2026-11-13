(() => {
  const ui = window.LocalhostInspector
  let pickerCount = 0
  const pickerLabels = {
    color: {
      title: 'Variables', list: 'Color variables', search: 'Search colors',
      empty: 'No color variables available', noMatch: 'No matches found for this search',
      applying: 'Applying color…', failed: 'Could not apply color. Try again.',
    },
    spacing: {
      title: 'Spacing variables', list: 'Spacing variables', search: 'Search spacing variables',
      empty: 'No spacing variables available', noMatch: 'No matches found for this search',
      applying: 'Applying spacing…', failed: 'Could not apply spacing. Try again.',
    },
    text: {
      title: 'Text styles', list: 'Text styles', search: 'Search text styles',
      empty: 'No text styles available.', noMatch: 'No styles match this search.',
      applying: 'Applying text style…', failed: 'Could not apply text style. Try again.',
    },
  }

  // The caller supplies resolved swatches and commits the selected ID.
  // A rejected commit must reject the callback rather than report success.
  ui.openColorVariablePicker = (anchor, settings) => openVariablePicker(anchor, settings)
  ui.openSpacingVariablePicker = (anchor, { variables, ...settings }) =>
    openVariablePicker(anchor, { ...settings, colors: variables, kind: 'spacing' })
  ui.openTextStylePicker = (anchor, { styles, ...settings }) =>
    openVariablePicker(anchor, { ...settings, colors: styles, kind: 'text' })

  function openVariablePicker(anchor, {
    colors, current, sourceLabel, onChoose, create, custom, initialTab = 'libraries', fallbackFocus,
    showLibraries = true, kind = 'color', emptyMessage,
  }) {
    if (anchor.getAttribute('aria-expanded') === 'true') {
      ui.closeMenu()
      return
    }

    const spacing = kind === 'spacing'
    const textStyles = kind === 'text'
    const labels = pickerLabels[kind]
    const { title, search: searchLabel } = labels
    const listId = 'li-picker-list-' + ++pickerCount
    const popup = ui.element('div', 'li-menu li-color-picker li-context-popup')
    if (spacing) popup.classList.add('li-spacing-picker')
    if (textStyles) popup.classList.add('li-text-style-picker')
    popup.setAttribute('role', 'dialog')
    popup.setAttribute('aria-label', title)
    const dismiss = ui.action('Close ' + title, 'dismiss', () => close())
    let closeCreate
    const add = create ? ui.action(textStyles ? 'Create style' : 'Create color variable', 'add', () => {
      if (pending) return
      if (add.getAttribute('aria-expanded') === 'true') closeCreate?.()
      else if (textStyles) closeCreate = ui.openCreateTextStyle(add, popup, create, () => close())
      else closeCreate = ui.openCreateColorVariable(add, popup, create, created => {
        current = created.id
        solid?.reset(created.value)
        const superseded = rows.findIndex(row => row.color.pending)
        if (superseded !== -1) rows.splice(superseded, 1)[0].option.remove()
        const row = makeRow(created)
        rows.unshift(row)
        list.prepend(row.option)
        updateSelection()
        filter()
        search.focus({ preventScroll: true })
      })
    }) : null
    if (add) {
      add.setAttribute('aria-haspopup', 'dialog')
      add.setAttribute('aria-expanded', 'false')
    }
    const tabs = ui.element('div', 'li-color-tabs')
    tabs.setAttribute('role', 'tablist')
    tabs.setAttribute('aria-label', 'Color source')
    const tabButtons = ['Custom', 'Libraries'].map(label => {
      const tab = ui.element('button', '', label)
      tab.type = 'button'
      tab.setAttribute('role', 'tab')
      tabs.append(tab)
      return tab
    })
    const header = ui.popupHeader(textStyles ? title : '', ...[add, dismiss].filter(Boolean))
    if (!textStyles) header.firstElementChild.replaceWith(tabs)
    const search = ui.element('input')
    search.type = 'text'
    search.placeholder = searchLabel
    search.autocomplete = 'off'
    search.spellcheck = false
    search.setAttribute('aria-label', searchLabel)
    search.setAttribute('role', 'combobox')
    search.setAttribute('aria-autocomplete', 'list')
    search.setAttribute('aria-expanded', 'true')
    search.setAttribute('aria-controls', listId)

    const searchRow = ui.element('div', 'li-color-picker-search')
    const clear = ui.action('Clear search', 'close', () => {
      search.value = ''
      filter()
      search.focus({ preventScroll: true })
    })
    searchRow.append(ui.icon('search'), search, clear)
    if (spacing) searchRow.append(dismiss)
    const list = ui.element('div', 'li-menu-list li-color-picker-list')
    list.id = listId
    list.setAttribute('role', 'listbox')
    list.setAttribute('aria-label', labels.list)
    const empty = ui.element('p', 'li-color-picker-message')
    empty.setAttribute('role', 'status')
    const feedback = ui.element('p', 'li-color-picker-message')
    feedback.setAttribute('role', 'status')
    feedback.hidden = true

    const libraries = ui.element('div', 'li-color-libraries')
    if (!textStyles) {
      libraries.setAttribute('role', 'tabpanel')
      libraries.setAttribute('aria-label', 'Libraries')
    }
    libraries.append(searchRow)
    if (sourceLabel) libraries.append(ui.element('div', 'li-color-picker-source', sourceLabel))
    libraries.append(list, empty, feedback)

    const solid = custom ? ui.solidColorPicker(custom.value, async value => {
      await custom.onChange(value)
      current = null
      updateSelection()
    }) : null
    tabButtons[0].hidden = !solid
    tabButtons[1].hidden = !showLibraries
    if (!spacing) popup.append(header)
    popup.append(libraries)
    if (solid) popup.append(solid.panel)

    function setTab(tab, focus = true) {
      if (spacing || textStyles) {
        if (focus) search.focus({ preventScroll: true })
        return
      }
      const customOpen = tab === 'custom' && solid
      libraries.hidden = Boolean(customOpen)
      if (solid) solid.panel.hidden = !customOpen
      if (!customOpen) solid?.stopSampling()
      popup.setAttribute('aria-label', customOpen ? 'Color picker' : title)
      for (const [index, button] of tabButtons.entries()) {
        const selected = Boolean(customOpen) === (index === 0)
        button.setAttribute('aria-selected', String(selected))
        button.tabIndex = selected ? 0 : -1
      }
      if (focus) (customOpen ? tabButtons[0] : search).focus({ preventScroll: true })
    }
    for (const [index, button] of tabButtons.entries()) {
      button.onclick = () => setTab(index === 0 ? 'custom' : 'libraries')
      button.onkeydown = event => {
        if (!solid || !showLibraries || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
        event.preventDefault()
        setTab(index === 0 ? 'libraries' : 'custom')
        tabButtons[1 - index].focus({ preventScroll: true })
      }
    }

    let active = null
    let pending = false
    let nextOption = 0
    function makeRow(color) {
      const option = ui.element('div', 'li-menu-option')
      option.id = listId + '-' + nextOption++
      option.setAttribute('role', 'option')
      if (spacing) {
        option.append(ui.icon('numberVariable'), ui.element('span', '', color.name),
          ui.element('span', 'li-spacing-option-value', color.value))
      } else if (textStyles) {
        const glyph = ui.element('span', 'li-text-style-glyph', 'Ag')
        glyph.setAttribute('aria-hidden', 'true')
        option.append(glyph, ui.element('span', 'li-text-style-option-name', color.name),
          ui.element('span', 'li-text-style-metrics', '· ' + color.metrics))
      } else option.append(ui.colorSwatch(color.value), ui.element('span', '', color.name))
      // Keep DOM focus on the search input while choosing an option by mouse.
      option.onmousedown = event => event.preventDefault()
      option.onclick = () => { void choose(color) }
      return { color, option }
    }
    const rows = colors.map(makeRow)
    list.append(...rows.map(row => row.option))

    function updateSelection() {
      for (const { color, option } of rows) {
        option.setAttribute('aria-selected', String(color.id === current))
      }
    }

    function highlight(row) {
      active?.option.removeAttribute('data-active')
      active = row ?? null
      if (active) {
        active.option.setAttribute('data-active', '')
        search.setAttribute('aria-activedescendant', active.option.id)
        active.option.scrollIntoView({ block: 'nearest' })
      } else {
        search.removeAttribute('aria-activedescendant')
      }
    }

    function filter() {
      const query = search.value.trim().toLowerCase()
      highlight(null)
      clear.hidden = search.value.length === 0
      for (const { color, option } of rows) {
        option.hidden = ![color.name, color.group, color.id].some(part => part?.toLowerCase().includes(query))
      }
      const hasResults = rows.some(row => !row.option.hidden)
      list.hidden = !hasResults
      empty.hidden = hasResults
      empty.textContent = colors.length ? labels.noMatch : emptyMessage ?? labels.empty
      search.setAttribute('aria-expanded', String(hasResults))
    }

    async function choose(color) {
      if (pending || color.id === current) return
      pending = true
      list.setAttribute('aria-busy', 'true')
      feedback.textContent = labels.applying
      feedback.hidden = false
      try {
        await onChoose(color.id)
        if (!popup.isConnected) return
        if (spacing || textStyles) { close(); return }
        current = color.id
        if (color.value) solid?.reset(color.value)
        const superseded = rows.findIndex(row => row.color.pending && row.color.id !== current)
        if (superseded !== -1) {
          rows.splice(superseded, 1)[0].option.remove()
          filter()
        }
        updateSelection()
        feedback.hidden = true
      } catch {
        if (popup.isConnected) feedback.textContent = labels.failed
      } finally {
        pending = false
        list.removeAttribute('aria-busy')
      }
    }

    search.oninput = filter
    search.onkeydown = event => {
      if (event.isComposing) return
      if (event.key === 'Enter' && active) {
        event.preventDefault()
        void choose(active.color)
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      event.preventDefault()
      const matches = rows.filter(row => !row.option.hidden)
      if (matches.length === 0) return
      const index = matches.indexOf(active)
      const next = event.key === 'ArrowDown' ? index + 1 : index < 0 ? matches.length - 1 : index - 1
      highlight(matches[(next + matches.length) % matches.length])
    }
    popup.onkeydown = event => {
      if (event.key !== 'Escape' || event.isComposing) return
      event.preventDefault()
      event.stopPropagation()
      if (textStyles && search.value) clear.click()
      else close()
    }
    popup.onfocusout = event => {
      if (event.relatedTarget && !anchor.contains(event.relatedTarget) && !popup.contains(event.relatedTarget)) close(false)
    }

    updateSelection()
    filter()
    setTab(initialTab, false)
    const panel = anchor.closest('.li-panel')
    const close = ui.mountPopup(anchor, popup, (rect, width) => [
      panel.getBoundingClientRect().left - width, rect.top,
    ], { closeOnPanelScroll: true, trackSize: true, fallbackFocus, onClose: () => {
      closeCreate?.(false)
      solid?.stopSampling()
    } })
    setTab(initialTab)
    return close
  }
})()
