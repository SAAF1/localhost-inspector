(() => {
  const ui = window.LocalhostInspector
  ui.createRevertDialog = root => {
    const dialog = ui.element('dialog', 'li-revert-dialog')
    const title = ui.element('h2', '', 'Revert all previews?')
    title.id = 'revert-title'
    const detail = ui.element('p', '', 'This removes all saved Inspector previews on this page.')
    detail.id = 'revert-description'
    dialog.setAttribute('aria-labelledby', title.id)
    dialog.setAttribute('aria-describedby', detail.id)
    const form = ui.element('form', 'li-dialog-actions')
    form.method = 'dialog'
    const cancel = ui.element('button', 'li-dialog-button', 'Cancel')
    cancel.type = 'submit'
    cancel.value = 'cancel'
    cancel.autofocus = true
    const revert = ui.element('button', 'li-dialog-button li-dialog-revert', 'Revert all')
    revert.type = 'submit'
    revert.value = 'revert'
    form.append(cancel, revert)
    dialog.append(title, detail, form)
    root.append(dialog)

    function confirm() {
      if (dialog.open) return Promise.resolve(false)
      ui.dismissTooltip()
      dialog.returnValue = ''
      dialog.showModal()
      return new Promise(resolve => {
        dialog.addEventListener('close', () => resolve(dialog.returnValue === 'revert'), { once: true })
      })
    }
    function dismiss() {
      if (dialog.open) dialog.close('cancel')
    }
    return { confirm, dismiss }
  }
})()
