import { createLayerHover, revealLayerLabel } from './workspace-layer-hover.mjs'
import { addLayerRow, toggleLayerBranch, updateLayerSelection, visibilityButton } from './workspace-layer-row.mjs'
import { layerDetails } from './workspace-layer-details.mjs'

// Inspector surfaces are siblings of the inspected app and never become layers.
const ignored = 'script,style,template,noscript,#localhost-inspector,#localhost-inspector-outlines,#localhost-inspector-dock,#localhost-inspector-spacing-preview,#localhost-inspector-text-editor'

export function createWorkspaceLayers({ getDocument, selectNode, componentFor, getOutline, onOpenOutline }) {
  const ui = window.LocalhostInspector
  let mount
  let source
  let sourceUrl
  let selected
  let selectedGroup = new Set()
  let revealNode
  let selectingRow = false
  const revealLabel = label => revealLayerLabel(mount, label)
  const hover = createLayerHover({ getMount: () => mount, getOutline, paint, revealLabel })
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
  let visibleRows = []
  let focused
  let disclosure = new WeakMap()
  const outlineDisclosure = new Map()
  let previousActive
  let previousRequest
  let previousSelection
  let defaultExpanded
  const collapse = ui.action('Collapse layers', 'collapsePages', () => {
    defaultExpanded = !mount.querySelector('[aria-expanded="true"]')
    disclosure = new WeakMap()
    outlineDisclosure.clear()
    if (!defaultExpanded) {
      function fold(items) {
        for (const item of items) {
          outlineDisclosure.set(item.key, false)
          if (item.children?.length) fold(item.children)
        }
      }
      fold(getOutline?.()?.items || [])
    }
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
      hover.clear()
      defaultExpanded = undefined
      source = doc
      sourceUrl = doc?.URL
      selectedGroup.clear()
      revealNode = null
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

  function setSelected(node, group = [], repeat = false) {
    const doc = getDocument()
    if (doc !== source || doc?.URL !== sourceUrl) watch(doc)
    if (node && (!node.isConnected || node.ownerDocument !== doc)) return
    if (selected === node && !selectedGroup.size && !group.length && !repeat) return
    const temporaryBranches = hover.hasTemporaryBranches
    if (node || group.length) hover.clear()
    selectedGroup = new Set(group)
    selected = node
    const targets = node ? [node] : group
    revealNode = selectingRow ? null : targets[0]
    for (const target of targets) {
      for (let parent = target.parentElement; parent && parent !== doc.body; parent = parent.parentElement) {
        disclosure.set(parent, true)
      }
    }
    if (!mount) return
    const current = getOutline?.()
    const visibleTarget = node && visibleRows.find(row => row.node === node)
    if (!temporaryBranches && visibleTarget && !group.length &&
        current?.activeKey === previousActive && current?.selectedKey === previousSelection) {
      for (const row of visibleRows) updateLayerSelection(row, row.node === node)
      if (revealNode) revealLabel(visibleTarget.text)
      revealNode = null
      return
    }
    paint()
  }

  function paint() {
    hover.resetRows()
    const tree = ui.element('div', 'workspace-layers-tree')
    tree.setAttribute('role', 'tree')
    tree.setAttribute('aria-label', 'Layers')
    const previousFocus = mount.getRootNode().activeElement
    const restoreFocus = mount.contains(previousFocus)
    const restoreEye = previousFocus?.classList.contains('workspace-layer-eye')
    const restorePointerFocus = previousFocus?.hasAttribute('data-pointer-focus')
    const rows = []
    visibleRows = rows
    let labelToReveal

    function focus(record) {
      if (!record) return
      focused = record.node
      const previous = tree.querySelector('[role=treeitem][tabindex="0"]')
      if (previous !== record.item) {
        if (previous) previous.tabIndex = -1
        record.item.tabIndex = 0
      }
      record.item.focus()
    }

    const outline = getOutline?.()
    const activeKey = outline?.activeKey
    const selectedKey = outline?.selectedKey
    const request = outline?.disclosureRequest
    if (request && request.version !== previousRequest) {
      hover.clear()
      outlineDisclosure.set(request.key, request.expanded)
    }
    previousRequest = request?.version
    const selectionChanged = selectedKey !== previousSelection
    const activeChanged = activeKey !== previousActive
    previousActive = activeKey
    previousSelection = selectedKey
    const liveSelection = selected?.isConnected || [...selectedGroup].some(node => node.isConnected)

    const rowContext = { ui, rows, focus, onFocus(node) { focused = node } }

    function append(nodes, container, level, parent, rootLevel = level) {
      for (const node of nodes) {
        const children = renderedChildren(node)
        const branch = children.length > 0
        const expanded = branch && hover.expand(node, disclosure.get(node) ?? defaultExpanded ?? level === rootLevel)
        const details = layerDetails(node, branch)
        const component = componentFor(node)
        const label = component || details.label
        const hidden = node.hasAttribute(hiddenAttribute)
        const eye = visibilityButton(ui, (hidden ? 'Show ' : 'Hide ') + label, hidden, () => toggleVisibility(node))
        const record = addLayerRow(rowContext, { node, container, level, parent, branch, expanded, label, hidden, eye, component,
          icon: component ? 'instance' : details.icon,
          title: component && details.label !== component ? component + ' · ' + details.label : label,
          direct: node === selected || selectedGroup.has(node),
          onToggle() {
            disclosure.set(node, !record.expanded)
            if (hover.hasTemporaryBranches) { paint(); return }
            toggleLayerBranch(ui, rows, record, () => append(renderedChildren(node), record.group, level + 1, record, rootLevel))
            hover.setRows(rows)
            syncCollapse()
          },
          onSelect() {
            if (!node.isConnected || node.ownerDocument !== getDocument()) return
            selectingRow = true
            try { if (selectNode(node) !== false) setSelected(node) }
            finally { selectingRow = false }
          },
        })
        if (node === revealNode) labelToReveal = record.text
        if (expanded) append(children, record.group, level + 1, record, rootLevel)
      }
    }

    function appendOutline(items, container, level, parent) {
      for (const item of items) {
        const section = item.kind === 'section'
        const children = item.children || []
        const active = item.key === activeKey
        const containsActive = children.some(child => child.key === activeKey)
        const containsSelected = children.some(child => child.key === selectedKey)
        const direct = item.key === selectedKey && (section || !liveSelection)
        const branch = !section || children.length > 0
        const openForSelection = (active || containsActive) && (activeChanged || revealNode)
          || selectionChanged && (direct || containsSelected)
        if (openForSelection && item.key !== request?.key) outlineDisclosure.delete(item.key)
        const expanded = branch && hover.expand(item.key, (section || active) && (outlineDisclosure.get(item.key) ?? true))
        const record = addLayerRow(rowContext, { node: item.key, container, level, parent, label: item.label, icon: item.kind,
          direct, branch, expanded: Boolean(expanded), outlineKind: item.kind,
          onSelect() { onOpenOutline(item.key, Boolean(expanded)) },
          onToggle() {
            if (!section && !active) {
              onOpenOutline(item.key, true)
              return
            }
            outlineDisclosure.set(item.key, !expanded)
            paint()
          },
        })
        if (selectionChanged && direct) labelToReveal = record.text
        if (!expanded) continue
        if (section) appendOutline(children, record.group, level + 1, record)
        else if ((active || (hover.document === source && item.key === (outline.sourceKey || outline.hoverKey))) && source?.body) append(renderedChildren(source.body), record.group, level + 1, record)
      }
    }

    if (outline) appendOutline(outline.items, tree, 1, null)
    else if (source?.body) append(renderedChildren(source.body), tree, 1, null)
    hover.setRows(rows)
    function syncCollapse() {
      collapse.disabled = !rows.some(row => row.branch)
      const label = rows.some(row => row.expanded) ? 'Collapse layers' : 'Expand layers'
      collapse.setAttribute('aria-label', label)
      ui.setTooltip(collapse, label)
    }
    syncCollapse()
    const nextFocus = rows.find(row => row.node === focused) ??
      rows.find(row => row.node === selected) ?? rows[0]
    if (!nextFocus) {
      mount.replaceChildren(ui.element('p', 'workspace-layer-empty', 'No rendered layers'))
      return
    }
    nextFocus.item.tabIndex = 0
    if (restoreFocus && restorePointerFocus) nextFocus.item.dataset.pointerFocus = ''
    mount.replaceChildren(tree)
    if (labelToReveal) {
      revealLabel(labelToReveal)
      revealNode = null
    }
    if (restoreFocus) ((restoreEye && nextFocus.eye) || nextFocus.item).focus({ preventScroll: true })
  }

  function render(container, header) {
    if (header) header.append(collapse)
    const doc = getDocument()
    const resume = container && !mount
    if (!container) { hover.clear(); hover.resetRows(); visibleRows = [] }
    mount = container
    if (!mount || resume || doc !== source || doc?.URL !== sourceUrl) watch(doc)
    if (mount) paint()
  }

  function setHovered(node) {
    if (node?.ownerDocument && (!node.isConnected || node.ownerDocument !== getDocument())) return
    hover.update(node)
  }

  return { render, setSelected, setHovered, syncOutlineHover: hover.syncOutlineHover }
}
