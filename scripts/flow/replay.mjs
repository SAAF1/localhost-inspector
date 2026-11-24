import { flowRoute, observePage, observeSurfaces } from './page-state.mjs'

export function waitFor(read, current, changedDocument) {
  return new Promise((resolve, reject) => {
    const end = performance.now() + 4500
    let observed, observer, timer, nextPaint
    function cleanup() {
      observer?.disconnect()
      clearTimeout(timer)
      cancelAnimationFrame(nextPaint)
    }
    function check() {
      clearTimeout(timer)
      cancelAnimationFrame(nextPaint)
      nextPaint = null
      try {
        if (!current() || performance.now() >= end) throw Error('State unavailable')
        const result = read()
        if (result) { cleanup(); resolve(result); return }
        const doc = changedDocument?.()
        if (doc && doc !== observed) {
          observer?.disconnect()
          observed = doc
          observer = new MutationObserver(() => { nextPaint ??= requestAnimationFrame(check) })
          observer.observe(doc, { childList: true, subtree: true, attributes: true, characterData: true })
        }
      } catch (error) { cleanup(); reject(error); return }
      // Navigation replaces the document. Styles and timers can change a
      // checkpoint without any DOM mutation, including in a background tab.
      timer = setTimeout(check, 25)
    }
    check()
  })
}

export function findControl(doc, step) {
  return observePage(doc, 'control', step)
}

export function openControl(control) {
  const view = control.ownerDocument.defaultView
  const events = { bubbles: true, cancelable: true, composed: true, button: 0, view }
  // Some tabs and popovers open on press rather than click.
  control.dispatchEvent(new view.PointerEvent('pointerdown', { ...events, pointerType: 'mouse', isPrimary: true, buttons: 1 }))
  control.dispatchEvent(new view.MouseEvent('mousedown', { ...events, buttons: 1 }))
  control.click()
}

export function matchesCheckpoint(doc, frame, surfaces) {
  if (frame.heading && observePage(doc, 'heading') !== frame.heading) return false
  if (!frame.checkpoint.length) return true
  surfaces ??= observeSurfaces(doc)
  return frame.checkpoint.every(check => surfaces.some(item => item.role === check.role && item.label === check.label))
}

export async function replayFrame(app, frame, current) {
  const doc = await waitFor(() => {
    const loaded = app.contentDocument
    return loaded && flowRoute(loaded.location) === frame.route && loaded.readyState !== 'loading' &&
      loaded.body?.innerText.trim() && loaded
  }, current, () => app.contentDocument)
  for (const step of frame.steps) {
    const control = await waitFor(() => doc === app.contentDocument && findControl(doc, step), current, () => doc)
    openControl(control)
  }
  await waitFor(() => doc === app.contentDocument && matchesCheckpoint(doc, frame), current, () => doc)
  for (const animation of doc.getAnimations()) {
    if (animation.playState === 'running' && animation.playbackRate > 0 &&
        Number.isFinite(animation.effect?.getComputedTiming().endTime)) animation.finish()
  }
  return doc
}
