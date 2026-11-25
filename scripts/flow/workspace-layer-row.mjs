// A tree can show hundreds of identical icons. Parse each SVG once.
const icons = new Map()
function layerIcon(ui, name) {
  if (!icons.has(name)) icons.set(name, ui.icon(name))
  return icons.get(name).cloneNode(true)
}

const eyeTemplates = new Map()
export function visibilityButton(ui, label, hidden, toggle) {
  if (!eyeTemplates.has(hidden)) {
    const template = ui.action('', hidden ? 'eyeClosed' : 'eye')
    template.classList.add('workspace-layer-eye')
    eyeTemplates.set(hidden, template)
  }
  const eye = eyeTemplates.get(hidden).cloneNode(true)
  ui.setTooltip(eye, label)
  eye.setAttribute('aria-label', label)
  eye.onclick = toggle
  return eye
}

export function updateLayerSelection(row, direct) {
  const value = direct ? 'direct' : row.parent?.inSelection ? 'inherited' : null
  row.inSelection = Boolean(value)
  if (row.selection === value) return
  row.selection = value
  if (value) row.item.dataset.selection = value
  else delete row.item.dataset.selection
  row.item.setAttribute('aria-selected', String(Boolean(value)))
}

export function addLayerRow({ ui, rows, focus, onFocus }, { node, container, level, parent, label, icon, component, direct,
  branch, expanded, eye, hidden, title, onSelect, onToggle, outlineKind }) {
  const item = ui.element('div', 'workspace-layer-item')
  item.setAttribute('role', 'treeitem')
  item.setAttribute('aria-level', String(level))
  item.setAttribute('aria-label', label)
  if (outlineKind) {
    item.dataset.outlineKey = node
    item.setAttribute('aria-roledescription', outlineKind)
  }
  item.tabIndex = -1
  item.addEventListener('focus', () => onFocus(node))
  item.addEventListener('blur', () => { delete item.dataset.pointerFocus })
  if (branch) item.setAttribute('aria-expanded', String(expanded))
  const line = ui.element('div', 'workspace-layer-line')
  line.style.setProperty('--layer-depth', String(level - 1))
  const caret = ui.element('span', 'workspace-layer-caret')
  if (branch) caret.append(layerIcon(ui, expanded ? 'chevronDown' : 'chevronRight'))
  line.toggleAttribute('data-component', Boolean(component))
  const type = layerIcon(ui, icon)
  type.classList.add('workspace-layer-kind')
  const text = ui.element('span', 'workspace-layer-label', label)
  text.title = title || label
  line.toggleAttribute('data-layer-hidden', Boolean(hidden))
  line.append(caret, type, text)
  if (eye) line.append(eye)
  item.append(line)
  container.append(item)
  const record = { node, item, text, eye, expanded, branch, parent, level, caret }
  updateLayerSelection(record, direct)
  rows.push(record)
  line.addEventListener('pointerdown', () => { item.dataset.pointerFocus = '' })
  line.addEventListener('click', event => {
    if (eye?.contains(event.target)) return
    if (event.detail > 0) item.dataset.pointerFocus = ''
    focus(record)
    if (branch && caret.contains(event.target)) onToggle()
    else onSelect()
  })
  item.addEventListener('keydown', event => {
    if (event.target !== item || event.altKey || event.ctrlKey || event.metaKey) return
    delete item.dataset.pointerFocus
    const index = rows.indexOf(record)
    switch (event.key) {
      case 'ArrowDown': focus(rows[index + 1]); break
      case 'ArrowUp': focus(rows[index - 1]); break
      case 'Home': focus(rows[0]); break
      case 'End': focus(rows.at(-1)); break
      case 'ArrowRight':
        if (record.expanded) focus(rows[index + 1])
        else if (branch) onToggle()
        break
      case 'ArrowLeft':
        if (record.expanded) onToggle()
        else focus(parent)
        break
      case 'Enter':
      case ' ': onSelect(); break
      default: return
    }
    event.preventDefault()
    event.stopPropagation()
  })
  if (expanded) {
    record.group = ui.element('div')
    record.group.setAttribute('role', 'group')
    item.append(record.group)
  }
  return record
}

export function toggleLayerBranch(ui, rows, row, renderChildren) {
  const index = rows.indexOf(row) + 1
  row.expanded = !row.expanded
  row.item.setAttribute('aria-expanded', String(row.expanded))
  row.caret.replaceChildren(ui.icon(row.expanded ? 'chevronDown' : 'chevronRight'))
  if (row.expanded) {
    row.group = ui.element('div')
    row.group.setAttribute('role', 'group')
    // Append descendants while detached, then insert them into keyboard order.
    const priorLength = rows.length
    renderChildren()
    rows.splice(index, 0, ...rows.splice(priorLength))
    row.item.append(row.group)
  } else {
    row.group.remove()
    row.group = null
    let end = index
    while (end < rows.length && rows[end].level > row.level) end++
    rows.splice(index, end - index)
  }
}
