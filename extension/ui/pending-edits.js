(() => {
  const ui = window.LocalhostInspector
  const humanize = value => value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ')
    .replace(/^./, letter => letter.toUpperCase())
  const sortOptions = [['page', 'By page'], ['recent', 'Most recent']]
  const properties = {
    'border-radius': 'Corner radius', 'background-color': 'Fill', color: 'Text color',
    'font-size': 'Text size', 'vertical-padding': 'Vertical padding', 'horizontal-padding': 'Horizontal padding',
  }
  function pagePath(route) {
    const [path, hash] = route.split('#')
    return (hash?.replace(/^!/, '') || path.split('?')[0]).split('?')[0].replace(/\/$/, '')
  }

  function pageName(route) {
    const path = pagePath(route)
    const names = path.split('/').filter(Boolean)
    return names.map(humanize).join(' / ') || 'Home'
  }

  ui.createPendingEdits = ({ host, root, panel, get, locate, openEdit, removeEdit, refresh, highlight }) => {
    const design = get('design-tab')
    const edits = get('edits-tab')
    const launcher = get('pending-launcher')
    const view = get('pending-view')
    view.tabIndex = -1
    const designView = get('design-view')
    const list = get('pending-list')
    const order = get('pending-order')
    let records = []
    let currentRoute
    let current = false
    let floating = false
    let recent = false
    let selectedId
    let disabled = false
    let priorFocus

    function close() {
      if (!floating) return
      floating = false
      highlight(null)
      sync()
    }

    function selectTab(value) {
      current = value
      close()
      highlight(null)
      sync()
      if (value) refresh()
    }

    function sync() {
      if (!records.length) floating = false
      if (host.dataset.pendingCount !== String(records.length)) host.dataset.pendingCount = String(records.length)
      host.toggleAttribute('data-pending-open', floating)
      edits.textContent = records.length ? 'Edits ' + records.length : 'Edits'
      launcher.querySelector('span').textContent = records.length
      launcher.setAttribute('aria-label', 'Pending edits, ' + records.length)
      launcher.setAttribute('aria-expanded', String(floating))
      launcher.hidden = !records.length || !panel.hidden || host.hasAttribute('data-workspace-toolbar')
      design.setAttribute('aria-selected', String(!current))
      edits.setAttribute('aria-selected', String(current))
      design.tabIndex = current ? -1 : 0
      edits.tabIndex = current ? 0 : -1
      designView.hidden = current
      view.hidden = !floating && !current
      view.setAttribute('role', floating ? 'region' : 'tabpanel')
      if (floating) {
        view.removeAttribute('aria-labelledby')
        view.setAttribute('aria-label', 'Pending edits')
      } else {
        view.removeAttribute('aria-label')
        view.setAttribute('aria-labelledby', 'edits-tab')
      }
      view.classList.toggle('li-pending-floating', floating)
      const container = floating ? root : panel
      if (order.getAttribute('aria-expanded') === 'true' && (view.hidden || view.parentNode !== container)) ui.closeMenu()
      if (floating && view.parentNode !== root) root.append(view)
      if (!floating && view.parentNode !== panel) panel.insertBefore(view, get('inspector-footer'))
      const sortLabel = sortOptions[Number(recent)][1]
      order.firstElementChild.textContent = sortLabel
      order.setAttribute('aria-label', 'Sort pending edits: ' + sortLabel)
      const focus = root.activeElement?.dataset.editId
      const action = root.activeElement?.className
      if (current || floating) renderList()
      if (focus) Array.from(list.querySelectorAll('[data-edit-id]'))
        .find(button => button.dataset.editId === focus && button.className === action)?.focus({ preventScroll: true })
    }

    function markSelected(id) {
      selectedId = id
      list.querySelector('[data-selected]')?.removeAttribute('data-selected')
      list.querySelector('.li-pending-open[data-edit-id="' + CSS.escape(id) + '"]')
        ?.parentElement.setAttribute('data-selected', '')
    }

    function renderList() {
      list.replaceChildren()
      if (!records.length) {
        list.append(ui.element('p', 'li-pending-empty', 'No pending edits'))
        return
      }
      const groups = new Map()
      for (const edit of records) {
        const page = recent ? '' : pagePath(edit.route)
        if (!groups.has(page)) groups.set(page, [])
        groups.get(page).push(edit)
      }
      for (const items of groups.values()) {
        const section = ui.element('section', 'li-pending-group')
        if (!recent) section.append(ui.element('h3', 'li-pending-page', pageName(items[0].route)))
        for (const edit of recent ? [...items].reverse() : items) {
          const row = ui.element('div', 'li-pending-row')
          const open = ui.element('button', 'li-pending-open')
          const remove = ui.action('Remove edit', 'dismiss')
          open.type = 'button'
          open.dataset.editId = remove.dataset.editId = edit.id
          row.toggleAttribute('data-selected', selectedId === edit.id)
          const node = edit.template || edit.route === currentRoute ? locate(edit.id) : null
          const observed = node?.getAttribute('aria-label') ||
            (node?.matches('button, a, label, h1, h2, h3') ? node.textContent.trim() : '')
          const target = edit.target
          const name = observed?.slice(0, 64) || humanize(target.slot || target.id || ({ div: 'Container', span: 'Text', tr: 'Row', td: 'Cell' }[target.tag] ?? target.tag ?? 'Element'))
          const detail = (properties[edit.property] ?? humanize(edit.property)) + '  ' + edit.before + ' → ' + edit.requested +
            (edit.template ? ' · Whole template' : '')
          open.append(ui.element('span', 'li-pending-name', name), ui.element('span', 'li-pending-detail',
            recent ? pageName(edit.route) + ' · ' + detail : detail))
          if (node) {
            open.addEventListener('pointerenter', () => highlight(edit.id))
            open.addEventListener('pointerleave', () => highlight(null))
            open.addEventListener('focus', () => highlight(edit.id))
            open.addEventListener('blur', () => highlight(null))
          }
          open.onclick = async () => {
            if (!await openEdit(edit)) return
            markSelected(edit.id)
            close()
          }
          remove.disabled = disabled
          remove.setAttribute('aria-label', 'Remove ' + name + ' edit')
          remove.onclick = () => removeEdit(edit.id)
          row.append(open, remove)
          section.append(row)
        }
        list.append(section)
      }
    }

    function toggle() {
      if (!panel.hidden || !records.length) return
      if (floating) close()
      else {
        priorFocus = root.activeElement ?? host.ownerDocument.activeElement
        floating = true
        sync()
        view.focus({ preventScroll: true })
        refresh()
      }
    }
    launcher.onclick = toggle
    host.addEventListener('toggle-pending-edits', toggle)
    host.addEventListener('inspector-visibility', () => controls.syncVisibility())
    design.onclick = () => selectTab(false)
    edits.onclick = () => selectTab(true)
    get('inspector-tabs').addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const next = event.key === 'Home' ? false : event.key === 'End' ? true : !current
      selectTab(next)
      ;(next ? edits : design).focus()
    })
    order.setAttribute('aria-haspopup', 'menu')
    order.setAttribute('aria-expanded', 'false')
    order.onclick = () => {
      if (order.getAttribute('aria-expanded') === 'true') { ui.closeMenu(); return }
      ui.openMenu(order, sortOptions, recent ? 'recent' : 'page', value => {
        recent = value === 'recent'
        highlight(null)
        sync()
      }, { label: 'Sort pending edits', below: true })
    }
    order.onkeydown = event => {
      if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return
      event.preventDefault()
      order.click()
    }
    view.addEventListener('keydown', event => {
      if (event.key === 'Escape' && floating) {
        event.stopPropagation()
        close()
        priorFocus?.focus()
      }
    })
    function watchOutside() {
      const controller = new AbortController()
      function outside(event) {
        if (floating && !event.composedPath().includes(host) && !event.target.closest?.('#pending-toggle')) close()
      }
      const options = { capture: true, signal: controller.signal }
      const ownerDocument = host.ownerDocument
      ownerDocument.addEventListener('pointerdown', outside, options)
      if (ownerDocument !== document) document.addEventListener('pointerdown', outside, options)
      window.addEventListener('pagehide', () => controller.abort(), { once: true })
    }
    watchOutside()
    window.addEventListener('pageshow', event => { if (event.persisted) watchOutside() })
    const controls = {
      markSelected,
      showEdits: () => selectTab(true),
      showDesign: () => { if (current || floating) selectTab(false) },
      update(next, route) {
        if (Array.isArray(next)) records = next
        currentRoute = route
        if (current || floating || edits.textContent !== (records.length ? 'Edits ' + records.length : 'Edits')) sync()
      },
      setDisabled(value) {
        if (disabled === value) return
        disabled = value
        for (const button of list.querySelectorAll('.li-pending-row > .li-icon-button')) button.disabled = disabled
      },
      syncVisibility() {
        if (!panel.hidden && floating) close()
        launcher.hidden = !records.length || !panel.hidden || host.hasAttribute('data-workspace-toolbar')
      },
    }
    sync()
    return controls
  }
})()
