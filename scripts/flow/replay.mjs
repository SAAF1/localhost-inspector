import { observePage, observeSurfaces } from './page-state.mjs'

export function waitFor(read, current) {
  return new Promise((resolve, reject) => {
    const end = performance.now() + 4500
    function check() {
      if (!current() || performance.now() >= end) return reject(Error('State unavailable'))
      try {
        const result = read()
        if (result) return resolve(result)
      } catch (error) { return reject(error) }
      setTimeout(check, 25)
    }
    check()
  })
}

export function findControl(doc, step) {
  const root = step.inMain ? doc.querySelector('main, [role="main"]') : doc
  const controls = root?.querySelectorAll(step.role === 'tab' ? '[role="tab"]' : 'button') ?? []
  const candidates = [...controls].filter(node => !node.disabled && !node.closest('th, [hidden], [inert]') &&
    node.getClientRects().length && (!step.popup || node.hasAttribute('aria-haspopup')) &&
    (node.getAttribute('role') || 'button') === step.role &&
    (node.getAttribute('aria-label') || node.innerText || node.title || '').trim().replace(/\s+/g, ' ') === step.label)
  return candidates.length === 1 ? candidates[0] : null
}

export function openControl(control) {
  const view = control.ownerDocument.defaultView
  const events = { bubbles: true, cancelable: true, composed: true, button: 0, view }
  // Some tabs and popovers open on press rather than click.
  control.dispatchEvent(new view.PointerEvent('pointerdown', { ...events, pointerType: 'mouse', isPrimary: true, buttons: 1 }))
  control.dispatchEvent(new view.MouseEvent('mousedown', { ...events, buttons: 1 }))
  control.click()
}

export function matchesCheckpoint(doc, frame, surfaces = observeSurfaces(doc)) {
  if (frame.heading && observePage(doc).heading !== frame.heading) return false
  return frame.checkpoint.every(check => surfaces.some(item => item.role === check.role && item.label === check.label))
}
