(() => {
  const ui = window.LocalhostInspector

  // The workspace can request a form. Its submission stays in Inspector's closed root.
  ui.connectWorkspaceTextStyle = ({ host, root, canCreate, save }) => {
    let close
    host.addEventListener('open-variables-text-style-form', event => {
      if (!canCreate() || typeof event.detail !== 'string' || event.detail.length > 1500) return
      let request
      try { request = JSON.parse(event.detail) } catch { return }
      const { id, values, left, top } = request ?? {}
      if (!Number.isSafeInteger(id) || !Number.isFinite(left) || !Number.isFinite(top) ||
          !values || !ui.textStyleProperties.every(property =>
        typeof values[property] === 'string' && CSS.supports(property, values[property]),
      )) return
      close?.()
      const marker = root.ownerDocument.createElement('span')
      marker.style.cssText = 'position:fixed;pointer-events:none;left:' + left + 'px;top:' + top + 'px'
      root.append(marker)
      let finished = false
      function finish(action) {
        if (finished) return
        finished = true
        if (close === dismiss) close = null
        host.dispatchEvent(new CustomEvent('variables-text-style-form-result', { detail: JSON.stringify({ id, action }) }))
      }
      function dismiss() { unmount(false) }
      const unmount = ui.openCreateTextStyle(marker, null, {
        capture: () => Object.fromEntries(ui.textStyleProperties.map(property => [property, values[property]])),
        submit: save,
        back: () => { dismiss(); finish('back') },
        mount: popup => ui.mountPopup(marker, popup, () => [left, top], {
          trackSize: true,
          onClose() {
            marker.remove()
            queueMicrotask(() => finish('dismissed'))
          },
        }),
      }, () => finish('created'))
      close = dismiss
      event.preventDefault()
    })
    host.addEventListener('close-variables-text-style-form', () => close?.())
    return () => close?.()
  }
})()
