(() => {
  const ui = window.LocalhostInspector
  ui.createPanel = () => {
    const dock = window.localhostInspectorDock
    const workspaceToolbar = dock?.hasAttribute('data-workspace-toolbar')
    const host = document.createElement('div')
    host.id = 'localhost-inspector'
    host.style.cssText = dock
      ? 'position:relative;z-index:2147483647;visibility:hidden'
      : 'position:fixed;bottom:12px;right:12px;z-index:2147483647;visibility:hidden'
    host.toggleAttribute('data-docked', Boolean(dock))
    host.toggleAttribute('data-workspace-toolbar', Boolean(workspaceToolbar))
    host.dataset.fontState = 'loading'
    ui.fontReady.then(loaded => {
      host.dataset.fontState = loaded ? 'loaded' : 'fallback'
      host.style.removeProperty('visibility')
    })
    const root = host.attachShadow({ mode: 'closed' })
    const style = document.createElement('style')
    style.textContent = ui.tokens + ui.styles + ui.panelStyles + ui.spacingStyles
    root.append(style)
    let outlineRoot = root
    if (dock) {
      // Keep these in the inspected document so its viewport clips the outlines.
      const overlayHost = document.createElement('div')
      overlayHost.id = 'localhost-inspector-outlines'
      overlayHost.style.cssText = 'position:fixed;top:0;left:0;z-index:2147483647;pointer-events:none'
      outlineRoot = overlayHost.attachShadow({ mode: 'open' })
      const overlayStyle = document.createElement('style')
      overlayStyle.textContent = ui.tokens + ui.outlineStyles
      outlineRoot.append(overlayStyle)
      document.documentElement.append(overlayHost)
    }
    const hoverOutline = ui.element('div', 'li-outline li-outline-hover')
    hoverOutline.id = 'hover-outline'
    hoverOutline.hidden = true
    const outline = ui.element('div', 'li-outline')
    outline.id = 'outline'
    outline.hidden = true
    const entry = ui.action('Open Inspector', 'launcherSliders')
    entry.id = 'entry'
    entry.classList.add('li-entry')
    entry.setAttribute('aria-controls', 'inspector-panel')
    entry.setAttribute('aria-expanded', 'false')
    const panel = ui.element('div', 'li-panel')
    panel.id = 'inspector-panel'
    panel.tabIndex = -1
    panel.hidden = true
    panel.setAttribute('role', 'region')
    panel.setAttribute('aria-label', 'Design inspector')

    const header = ui.element('header', 'li-header li-panel-toolbar')
    const parent = ui.action('Select parent element', 'selectParent')
    parent.id = 'parent'
    parent.hidden = true
    const collapse = ui.action('Collapse Inspector', 'dockInspector')
    collapse.id = 'close-inspector'
    const headerActions = ui.row(parent)
    headerActions.classList.add('li-panel-actions')
    header.append(headerActions)

    const properties = ui.element('div', 'li-properties')
    const guidance = ui.element('div', 'li-guidance')
    guidance.id = 'guidance'
    guidance.append(
      ui.element('strong', '', 'Command-click an element'),
      ui.element('span', '', 'Hold Command and hover to preview.'),
    )
    const fields = ui.element('div')
    fields.id = 'fields'
    properties.append(guidance, fields)

    const footer = ui.element('footer', 'li-footer')
    const status = ui.element('output', 'li-status')
    status.id = 'status'
    status.setAttribute('aria-live', 'polite')
    const tabs = ui.element('div', 'li-inspector-tabs')
    tabs.id = 'inspector-tabs'
    tabs.setAttribute('role', 'tablist')
    tabs.setAttribute('aria-label', 'Inspector view')
    for (const [id, label, target] of [['design-tab', 'Design', 'design-view'], ['edits-tab', 'Edits', 'pending-view']]) {
      const tab = ui.element('button', '', label)
      tab.id = id
      tab.type = 'button'
      tab.setAttribute('role', 'tab')
      tab.setAttribute('aria-controls', target)
      tabs.append(tab)
    }
    const design = ui.element('div', 'li-design-view')
    design.id = 'design-view'
    design.setAttribute('role', 'tabpanel')
    design.setAttribute('aria-labelledby', 'design-tab')
    const selectedName = ui.element('span', 'li-selected-name')
    selectedName.id = 'selected-name'
    header.prepend(selectedName)
    const pending = ui.element('div', 'li-pending-view')
    pending.id = 'pending-view'
    pending.hidden = true
    const pendingHeader = ui.element('div', 'li-pending-header')
    const order = ui.selectTrigger('Sort pending edits')
    order.id = 'pending-order'
    order.classList.add('li-pending-order')
    pendingHeader.append(order)
    const pendingList = ui.element('div', 'li-pending-list')
    pendingList.id = 'pending-list'
    const pendingStatus = ui.element('output', 'li-status')
    pendingStatus.id = 'pending-status'
    pendingStatus.setAttribute('aria-live', 'polite')
    pending.append(pendingHeader, pendingStatus, pendingList)
    const pendingLauncher = ui.element('button', 'li-pending-launcher')
    pendingLauncher.id = 'pending-launcher'
    pendingLauncher.type = 'button'
    pendingLauncher.hidden = true
    pendingLauncher.setAttribute('aria-controls', 'pending-view')
    pendingLauncher.append(ui.icon('editPencil'), ui.element('span'), ui.icon('chevronDown'))
    footer.id = 'inspector-footer'
    const comparison = ui.element('span', 'li-comparison-label', 'Original view')
    comparison.id = 'comparison-mode'
    comparison.hidden = true
    const actions = ui.row()
    actions.classList.add('li-panel-actions')
    actions.setAttribute('role', 'group')
    actions.setAttribute('aria-label', 'Preview actions')
    for (const [id, label, icon] of [
      ['undo', 'Undo last preview', 'undoPreview'],
      ['clear', 'Show original', 'comparePreview'],
      ['reset', 'Revert all previews', 'revertPreviews'],
    ]) {
      const button = ui.action(label, icon, undefined, true)
      button.id = id
      actions.append(button)
    }
    actions.querySelector('#clear').setAttribute('aria-pressed', 'false')
    actions.querySelector('#reset').setAttribute('aria-haspopup', 'dialog')
    pendingHeader.prepend(actions)
    pendingHeader.after(comparison)
    footer.append(status)
    design.append(header, properties)
    panel.append(tabs, design, pending, footer, collapse)
    const related = ui.element('div')
    related.id = 'related-outlines'
    related.setAttribute('aria-hidden', 'true')
    const textHover = ui.element('div')
    textHover.id = 'text-hover-outlines'
    outlineRoot.append(related, textHover, hoverOutline, outline)
    root.append(entry, pendingLauncher, panel)
    function setOpen(open, floating = false) {
      panel.hidden = !open
      entry.setAttribute('aria-expanded', String(open))
      entry.hidden = open
      host.dispatchEvent(new Event('inspector-visibility'))
      dock?.toggleAttribute('data-inspector-open', open)
      if (workspaceToolbar) dock.toggleAttribute('data-inspector-floating', open && floating)
    }
    function mountDock() {
      dock.replaceChildren(host)
      setOpen(dock.hasAttribute('data-inspector-open'), dock.hasAttribute('data-inspector-floating'))
    }
    if (dock) {
      mountDock()
      window.addEventListener('pageshow', event => { if (event.persisted) mountDock() })
    } else {
      document.documentElement.append(host)
    }
    ui.bindTooltips(root)
    const get = id => root.getElementById(id) ?? outlineRoot.getElementById(id)
    return { host, root, panel, setOpen, get }
  }
})()
