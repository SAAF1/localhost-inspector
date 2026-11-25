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
  let view = 'Inbox'
  function show(label) {
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
  function render() {
    const focused = list.getRootNode().activeElement?.dataset?.variantId
    const recent = view === 'Recent'
    const items = entries.filter(item => (item.respondedAt != null) === recent)
      .sort((a, b) => (recent ? b.respondedAt - a.respondedAt : b.created - a.created))
    const rows = items.map(item => {
      const row = ui.element('button', 'activity-row')
      row.type = 'button'
      row.dataset.variantId = item.id
      row.title = [item.section, item.label, item.note].filter(Boolean).join(' · ')
      row.append(ui.icon('frame'), ui.element('span', '', item.label))
      row.onclick = () => onOpen(item.id)
      return row
    })
    list.replaceChildren(...(rows.length ? rows : [ui.element('p', 'activity-empty', recent ? 'No responses yet.' : 'No variants awaiting feedback.')]))
    if (focused) (rows.find(row => row.dataset.variantId === focused) ?? buttons.find(tab => tab.tabIndex === 0)).focus({ preventScroll: true })
  }
  show(view)
  return { element, list, update(items) { entries = items ?? []; render() } }
}
