// A canvas visit and a response are separate actions. The canvas registry owns
// review state; opening a row here only navigates to its variant.
export function createWorkspaceActivity(ui, onOpen) {
  const element = ui.element('section', 'activity')
  element.setAttribute('aria-label', 'Activity')
  const tabs = ui.element('div', 'li-segments activity-tabs')
  tabs.setAttribute('role', 'tablist')
  tabs.setAttribute('aria-label', 'Variant activity')
  const list = ui.element('div', 'activity-list')
  list.id = 'variant-activity-list'
  list.setAttribute('role', 'tabpanel')
  const content = ui.element('div', 'activity-content')
  const rowHeight = 30
  list.style.setProperty('--activity-row-height', rowHeight + 'px')
  list.append(content)
  const buttons = ['Inbox', 'Recent'].map(label => {
    const tab = ui.element('button', '', label)
    tab.type = 'button'
    tab.id = 'variant-activity-' + label.toLowerCase()
    tab.setAttribute('role', 'tab')
    tab.setAttribute('aria-controls', list.id)
    tab.onclick = () => show(label)
    tabs.append(tab)
    return tab
  })
  tabs.onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'End', 'Home'].includes(event.key)) return
    event.preventDefault()
    const next = event.key === 'Home' ? buttons[0] : event.key === 'End' ? buttons[1] : buttons.find(tab => tab !== event.target)
    next.focus()
    next.click()
  }
  element.append(tabs, list)
  let entries = []
  let items = []
  let dirty = true
  let view = 'Inbox'
  const rows = new Map()
  const offsets = { Inbox: 0, Recent: 0 }
  let restoreOffset
  let previousStart, previousEnd
  function show(label) {
    if (view !== label) {
      offsets[view] = list.scrollTop
      restoreOffset = offsets[label]
      dirty = true
    }
    view = label
    for (const tab of buttons) {
      const selected = tab.textContent === view
      tab.setAttribute('aria-selected', String(selected))
      tab.classList.toggle('li-selected', selected)
      tab.tabIndex = selected ? 0 : -1
      if (selected) list.setAttribute('aria-labelledby', tab.id)
    }
    render()
  }
  const empty = ui.element('p', 'activity-empty')
  function render() {
    const height = list.clientHeight
    if (!height) return
    const active = list.getRootNode().activeElement
    const focused = content.contains(active) && active.dataset.variantId
    let focusedIndex = focused ? Number(active.dataset.index) : -1
    if (dirty) {
      const recent = view === 'Recent'
      const offset = list.scrollTop
      const index = Math.floor(offset / rowHeight)
      const anchor = index > 0 && items[index]?.id
      items = entries.filter(item => (item.respondedAt != null) === recent)
        .sort((a, b) => recent ? b.respondedAt - a.respondedAt : b.created - a.created)
      content.style.height = items.length * rowHeight + 'px'
      empty.textContent = recent ? 'No responses yet.' : 'No variants awaiting feedback.'
      if (!items.length) list.append(empty)
      else empty.remove()
      if (restoreOffset !== undefined) list.scrollTop = restoreOffset
      else if (anchor) {
        const next = items.findIndex(item => item.id === anchor)
        if (next !== -1) list.scrollTop = offset + (next - index) * rowHeight
      }
      if (focused) focusedIndex = items.findIndex(item => item.id === focused)
      restoreOffset = undefined
    }
    const start = items.length <= 50 ? 0 : Math.max(0, Math.floor(list.scrollTop / rowHeight) - 3)
    const end = items.length <= 50 ? items.length : Math.min(items.length, Math.ceil((list.scrollTop + height) / rowHeight) + 3)
    if (!dirty && start === previousStart && end === previousEnd) return
    previousStart = start
    previousEnd = end
    // Keep the native entry and exit tab stops, plus any button still focused
    // while the mouse scrolls the list elsewhere.
    const indices = new Set()
    if (items.length) { indices.add(0); indices.add(items.length - 1) }
    if (focusedIndex >= 0) indices.add(focusedIndex)
    for (let i = start; i < end; i++) indices.add(i)
    const keep = new Set([...indices].map(index => items[index].id))
    for (const [id, row] of rows) {
      if (keep.has(id)) continue
      row.remove()
      rows.delete(id)
    }
    let before = null
    for (const index of [...indices].sort((a, b) => b - a)) {
      const item = items[index]
      let row = rows.get(item.id)
      if (!row) {
        row = ui.element('button', 'activity-row')
        row.type = 'button'
        row.dataset.variantId = item.id
        row.append(ui.icon('frame'), ui.element('span'))
        row.onclick = () => onOpen(item.id)
        rows.set(item.id, row)
      }
      if (dirty || !row.parentElement) {
        row.title = [item.section, item.label, item.note].filter(Boolean).join(' · ')
        row.lastElementChild.textContent = item.label
      }
      if (row.dataset.index !== String(index)) {
        row.dataset.index = String(index)
        row.style.top = index * rowHeight + 'px'
      }
      if (!row.parentElement) content.insertBefore(row, before)
      else if (row !== active && row.nextSibling !== before) content.moveBefore(row, before)
      before = row
    }
    if (focused && focusedIndex < 0) buttons.find(tab => tab.tabIndex === 0).focus({ preventScroll: true })
    dirty = false
  }
  list.onkeydown = event => {
    if (event.key !== 'Tab' || !event.target.matches('.activity-row')) return
    const next = Number(event.target.dataset.index) + (event.shiftKey ? -1 : 1)
    if (!items[next] || rows.has(items[next].id)) return
    event.preventDefault()
    list.scrollTop = next * rowHeight
    render()
    rows.get(items[next].id).focus()
  }
  list.addEventListener('scroll', render, { passive: true })
  new ResizeObserver(render).observe(list)
  show(view)
  return { element, list, update(next) { entries = next ?? []; dirty = true; render() } }
}
