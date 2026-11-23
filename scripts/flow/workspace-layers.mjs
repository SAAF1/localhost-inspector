// Inspector surfaces are siblings of the inspected app and never become layers.
const ignored = 'script,style,template,noscript,#localhost-inspector,#localhost-inspector-outlines,#localhost-inspector-dock,#localhost-inspector-spacing-preview,#localhost-inspector-text-editor'

const names = {
  a: 'Link', article: 'Article', aside: 'Sidebar', blockquote: 'Quote',
  button: 'Button', dialog: 'Dialog', div: 'Group', fieldset: 'Fieldset',
  footer: 'Footer', form: 'Form', header: 'Header', img: 'Image', input: 'Input',
  label: 'Label', li: 'List item', main: 'Main', nav: 'Navigation',
  ol: 'List', p: 'Paragraph', section: 'Section', select: 'Select', span: 'Text',
  table: 'Table', tbody: 'Table body', td: 'Cell', textarea: 'Text area',
  th: 'Column header', thead: 'Table header', tr: 'Row', ul: 'List',
}

const roleNames = {
  button: 'Button', checkbox: 'Checkbox', combobox: 'Combo box', dialog: 'Dialog',
  grid: 'Grid', img: 'Image', list: 'List', menu: 'Menu', menuitem: 'Menu item',
  navigation: 'Navigation', radio: 'Radio', search: 'Search', slider: 'Slider',
  switch: 'Switch', tab: 'Tab', tablist: 'Tabs', textbox: 'Text field',
}

function layerDetails(node, hasChildren) {
  const tag = node.localName
  const slot = node.getAttribute('data-slot')
  const role = node.getAttribute('role')?.split(/\s+/)[0]
  const roleName = Object.hasOwn(roleNames, role) ? roleNames[role] : undefined
  const heading = /^h[1-6]$/.test(tag) || role === 'heading'
  const directText = [...node.childNodes].filter(child => child.nodeType === 3)
    .map(child => child.textContent).join(' ')
  const labelledBy = (node.getAttribute('aria-labelledby') || '').split(/\s+/)
    .map(id => node.ownerDocument.getElementById(id)?.textContent || '').join(' ')
  if (tag === 'svg') {
    const label = [node.getAttribute('aria-label'), labelledBy, node.querySelector(':scope > title')?.textContent]
      .map(value => value?.trim()).find(Boolean)
    return { label: label || 'Icon', icon: 'vectorLayer' }
  }
  const isControl = ['button', 'a', 'summary', 'label'].includes(tag) || roleName === 'Button'
  const text = [node.getAttribute('aria-label'), labelledBy, node.getAttribute('alt'), directText,
    heading || isControl ? node.innerText : '', node.getAttribute('placeholder')]
    .map(value => value?.replace(/\s+/g, ' ').trim()).find(Boolean)
  const slotName = slot?.replace(/[-_]+/g, ' ').trim()
  const type = heading ? 'Heading' : roleName || (slotName
    ? slotName[0].toUpperCase() + slotName.slice(1) : Object.hasOwn(names, tag) ? names[tag] : tag)
  let icon = 'frame'
  if (['grid', 'table'].includes(role || tag)) icon = 'layoutSettings'
  else if (text && !hasChildren && !isControl && tag !== 'img') icon = 'textLayer'
  else if (hasChildren) {
    const style = node.ownerDocument.defaultView.getComputedStyle(node)
    if (style.display.includes('flex')) icon = style.flexDirection.startsWith('column') ? 'flowColumn' : 'flowRow'
  }
  return { label: (text || type).slice(0, 200), icon }
}

export function createWorkspaceLayers({ getDocument, selectNode, componentFor }) {
  const ui = window.LocalhostInspector
  let mount
  let source
  let sourceUrl
  let selected
  let selectedGroup = new Set()
  const hiddenAttribute = 'data-localhost-inspector-layer-hidden'
  const visibilitySheets = new WeakMap()
  function toggleVisibility(node) {
    const doc = node.ownerDocument
    if (!visibilitySheets.has(doc)) {
      const sheet = new doc.defaultView.CSSStyleSheet()
      sheet.replaceSync('[' + hiddenAttribute + '] { display: none !important; }')
      doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet]
      visibilitySheets.set(doc, sheet)
    }
    node.toggleAttribute(hiddenAttribute)
    focused = node
    paint()
  }
  let focused
  let disclosure = new WeakMap()
  let defaultExpanded
  const collapse = ui.action('Collapse layers', 'collapsePages', () => {
    defaultExpanded = !mount.querySelector('[aria-expanded="true"]')
    disclosure = new WeakMap()
    paint()
  })
  collapse.classList.add('li-audit-collapse')
  let observer
  let pending

  function renderedChildren(parent) {
    if (parent.localName === 'svg') return []
    const result = []
    const view = parent.ownerDocument.defaultView
    for (const child of parent.children) {
      if (!(child instanceof view.HTMLElement || child instanceof view.SVGSVGElement) || child.matches(ignored)) continue
      if (child.hasAttribute(hiddenAttribute)) {
        result.push(child)
        continue
      }
      const style = view.getComputedStyle(child)
      if (style.display === 'none') continue
      if (style.display === 'contents' || style.visibility === 'hidden' || style.visibility === 'collapse') {
        result.push(...renderedChildren(child))
      } else if (child.getClientRects().length) {
        result.push(child)
      }
    }
    return result
  }

  function watch(doc) {
    observer?.disconnect()
    source?.defaultView?.removeEventListener('resize', schedule)
    if (doc !== source || (doc && doc.URL !== sourceUrl)) {
      defaultExpanded = undefined
      source = doc
      sourceUrl = doc?.URL
      selectedGroup.clear()
      selected = null
      focused = null
      disclosure = new WeakMap()
    }
    if (!doc?.body || !mount) return
    observer = new doc.defaultView.MutationObserver(records => {
      if (records.some(record => {
        const element = record.target.nodeType === 1 ? record.target : record.target.parentElement
        if (element?.closest(ignored)) return false
        if (record.type !== 'childList') return true
        return [...record.addedNodes, ...record.removedNodes].some(node => !node.matches?.(ignored))
      })) schedule()
    })
    observer.observe(doc.body, { subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ['aria-label', 'aria-labelledby', 'role', 'alt', 'placeholder', 'data-slot', 'data-inspector-source', 'data-inspector-instance', 'class', 'style', 'hidden', 'open'] })
    doc.defaultView.addEventListener('resize', schedule)
  }

  function schedule() {
    if (!mount || pending) return
    pending = requestAnimationFrame(() => {
      pending = null
      if (mount?.isConnected) render(mount)
    })
  }

  function setSelected(node, group = []) {
    const doc = getDocument()
    if (doc !== source || doc?.URL !== sourceUrl) watch(doc)
    if (node && (!node.isConnected || node.ownerDocument !== doc)) return
    if (selected === node && !selectedGroup.size && !group.length) return
    selectedGroup = new Set(group)
    selected = node
    for (let parent = node?.parentElement; parent && parent !== doc.body; parent = parent.parentElement) {
      disclosure.set(parent, true)
    }
    if (mount) paint()
  }

  function paint() {
    const tree = ui.element('div', 'workspace-layers-tree')
    tree.setAttribute('role', 'tree')
    tree.setAttribute('aria-label', 'Layers')
    const previousFocus = mount.getRootNode().activeElement
    const restoreFocus = mount.contains(previousFocus)
    const restoreEye = previousFocus?.classList.contains('workspace-layer-eye')
    const rows = []

    function focus(record) {
      if (!record) return
      focused = record.node
      for (const row of rows) row.item.tabIndex = row === record ? 0 : -1
      record.item.focus()
    }

    function toggle(record) {
      disclosure.set(record.node, !record.expanded)
      focused = record.node
      paint()
    }

    function select(record) {
      if (!record.node.isConnected || record.node.ownerDocument !== getDocument()) return
      if (selectNode(record.node) !== false) setSelected(record.node)
    }

    function append(nodes, container, level, parent) {
      for (const node of nodes) {
        const children = renderedChildren(node)
        const branch = children.length > 0
        const expanded = branch && (disclosure.get(node) ?? defaultExpanded ?? level === 1)
        const item = ui.element('div', 'workspace-layer-item')
        item.setAttribute('role', 'treeitem')
        item.setAttribute('aria-level', String(level))
        const inSelection = Boolean(parent?.inSelection || node === selected || selectedGroup.has(node))
        item.setAttribute('aria-selected', String(inSelection))
        item.tabIndex = -1
        item.addEventListener('focus', () => { focused = node })
        if (branch) item.setAttribute('aria-expanded', String(expanded))
        const { label: contentLabel, icon } = layerDetails(node, branch)
        const component = componentFor(node)
        const label = component || contentLabel
        item.setAttribute('aria-label', label)
        const line = ui.element('div', 'workspace-layer-line')
        line.style.setProperty('--layer-depth', String(level - 1))
        const caret = ui.element('span', 'workspace-layer-caret')
        if (branch) caret.append(ui.icon(expanded ? 'chevronDown' : 'chevronRight'))
        line.toggleAttribute('data-component', Boolean(component))
        const type = ui.icon(component ? 'instance' : icon)
        type.classList.add('workspace-layer-kind')
        const text = ui.element('span', 'workspace-layer-label', label)
        text.title = component && contentLabel !== component ? component + ' · ' + contentLabel : label
        const hidden = node.hasAttribute(hiddenAttribute)
        const eye = ui.action((hidden ? 'Show ' : 'Hide ') + label, hidden ? 'eyeClosed' : 'eye', () => toggleVisibility(node))
        eye.classList.add('workspace-layer-eye')
        line.toggleAttribute('data-layer-hidden', hidden)
        line.append(caret, type, text, eye)
        item.append(line)
        container.append(item)
        const record = { node, item, eye, expanded, branch, parent, inSelection }
        rows.push(record)

        // The treeitem is the only keyboard stop; the chevron mirrors ArrowLeft/Right.
        line.addEventListener('click', event => {
          if (eye.contains(event.target)) return
          focus(record)
          if (branch && caret.contains(event.target)) toggle(record)
          else select(record)
        })
        item.addEventListener('keydown', event => {
          if (event.target !== item || event.altKey || event.ctrlKey || event.metaKey) return
          const index = rows.indexOf(record)
          switch (event.key) {
            case 'ArrowDown': focus(rows[index + 1]); break
            case 'ArrowUp': focus(rows[index - 1]); break
            case 'Home': focus(rows[0]); break
            case 'End': focus(rows.at(-1)); break
            case 'ArrowRight':
              if (branch) {
                if (expanded) focus(rows[index + 1])
                else toggle(record)
              }
              break
            case 'ArrowLeft':
              if (expanded) toggle(record)
              else focus(parent)
              break
            case 'Enter':
            case ' ': select(record); break
            default: return
          }
          event.preventDefault()
          event.stopPropagation()
        })
        if (expanded) {
          const group = ui.element('div')
          group.setAttribute('role', 'group')
          item.append(group)
          append(children, group, level + 1, record)
        }
      }
    }

    if (source?.body) append(renderedChildren(source.body), tree, 1, null)
    collapse.disabled = !rows.some(row => row.branch)
    const label = rows.some(row => row.expanded) ? 'Collapse layers' : 'Expand layers'
    collapse.setAttribute('aria-label', label)
    ui.setTooltip(collapse, label)
    const nextFocus = rows.find(row => row.node === focused) ??
      rows.find(row => row.node === selected) ?? rows[0]
    if (!nextFocus) {
      mount.replaceChildren(ui.element('p', 'workspace-layer-empty', 'No rendered layers'))
      return
    }
    nextFocus.item.tabIndex = 0
    mount.replaceChildren(tree)
    if (restoreFocus) (restoreEye ? nextFocus.eye : nextFocus.item).focus({ preventScroll: true })
  }

  function render(container, header) {
    if (header) header.append(collapse)
    const doc = getDocument()
    const resume = container && !mount
    mount = container
    if (!mount || resume || doc !== source || doc?.URL !== sourceUrl) watch(doc)
    if (mount) paint()
  }

  return { render, setSelected }
}
