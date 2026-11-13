(() => {
  const ui = window.LocalhostInspector
  ui.bindInspectorShortcuts = ({ root, panel, selection, undo, parent }) => {
    const mac = /Mac|iPhone|iPad/i.test(navigator.platform)
    undo.setAttribute('aria-keyshortcuts', mac ? 'Meta+Z' : 'Control+Z')
    ui.setTooltip(undo, 'Undo last preview (' + (mac ? '⌘Z' : 'Ctrl+Z') + ')')
    parent.setAttribute('aria-keyshortcuts', 'Shift+Enter')
    ui.setTooltip(parent, 'Select parent element (Shift+Enter)')

    function onShortcut(event) {
      if (!event.isTrusted || panel.hidden || event.defaultPrevented || event.repeat || event.isComposing || event.altKey) return
      if (root.querySelector('dialog[open]')) return
      const path = event.composedPath()
      if (path.some(node => node.isContentEditable || node.matches?.('input, textarea, select, [role="textbox"]'))) return
      // A focused Inspector control or a selection with focus on the app canvas
      // owns these commands. App controls and the Inspector's menus keep their keys.
      const target = path[0]
      if (!path.includes(panel) && (!selection.current?.isConnected ||
          (target !== document.body && target !== document.documentElement))) return
      const primary = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
      let action
      if (primary && !event.shiftKey && event.key.toLowerCase() === 'z') action = undo
      if (!event.metaKey && !event.ctrlKey && event.shiftKey && event.key === 'Enter') action = parent
      if (!action || action.hidden || action.disabled) return
      event.preventDefault()
      event.stopPropagation()
      action.click()
    }
    root.addEventListener('keydown', onShortcut)
    document.addEventListener('keydown', onShortcut)
  }
})()
