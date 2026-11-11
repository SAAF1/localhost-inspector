(() => {
  const ui = window.LocalhostInspector
  ui.createPanel = () => {
    const host = document.createElement('div')
    host.id = 'localhost-inspector'
    host.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:2147483647;visibility:hidden'
    host.dataset.fontState = 'loading'
    ui.fontReady.then(loaded => {
      host.dataset.fontState = loaded ? 'loaded' : 'fallback'
      host.style.removeProperty('visibility')
    })
    const root = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = ui.tokens + ui.styles
    root.append(style)
    const outline = ui.element('div', 'li-outline')
    outline.id = 'outline'
    outline.hidden = true
    const entry = ui.element('button', 'li-button li-entry', 'Inspector')
    entry.id = 'entry'
    entry.type = 'button'
    entry.setAttribute('aria-expanded', 'false')
    const panel = ui.element('div', 'li-panel')
    panel.hidden = true
    panel.setAttribute('role', 'region')
    panel.setAttribute('aria-label', 'Design inspector')
    const header = ui.element('header', 'li-header')
    const target = ui.element('strong', 'li-header-title', 'Command-click an element')
    target.id = 'target'
    const parent = ui.element('button', 'li-button', 'Parent')
    parent.id = 'parent'
    parent.type = 'button'
    parent.disabled = true
    header.append(target, parent)
    const fields = ui.element('div')
    fields.id = 'fields'
    const footer = ui.element('footer', 'li-footer')
    const actions = ui.row()
    for (const [id, label] of [['undo', 'Undo'], ['clear', 'Before'], ['reset', 'Reset']]) {
      const button = ui.element('button', 'li-button', label)
      button.type = 'button'
      button.id = id
      actions.append(button)
    }
    const status = ui.element('output', 'li-status')
    status.id = 'status'
    status.setAttribute('aria-live', 'polite')
    footer.append(actions, status)
    panel.append(header, fields, footer)
    root.append(outline, entry, panel)
    document.documentElement.append(host)
    return { host, root, panel, get: id => root.getElementById(id) }
  }
})()
