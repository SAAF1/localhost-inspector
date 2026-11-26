// Command arms the pointed card. Plain hover is an opt-in comparison. A moving pointer or
// a wheel gesture must never start a tour of speculative app documents.
const mode = new URLSearchParams(globalThis.location?.search).get('warm') ?? 'command'
const enabled = typeof document !== 'undefined' && (mode === '1' || mode === 'command')
const covers = new WeakMap()
let current
let timer
let discard

function clear() {
  clearTimeout(timer)
  discard?.()
  current = discard = null
}

if (enabled) {
  let pointed
  function schedule(cover, delay) {
    const warm = covers.get(cover)
    if (current !== cover) clear()
    if (!warm || discard) return
    current = cover
    clearTimeout(timer)
    const start = () => {
      if (cover.isConnected && cover.matches(':hover') && cover.getBoundingClientRect().width >= 280) discard = warm()
    }
    if (delay) timer = setTimeout(start, delay)
    else start()
  }
  document.addEventListener('pointermove', event => {
    if (!event.isTrusted || event.pointerType !== 'mouse' || event.buttons) return
    pointed = event.target
    if (mode === '1' || event.metaKey) schedule(pointed, mode === '1' ? 120 : 45)
  }, { passive: true })
  document.addEventListener('keydown', event => {
    if (mode === 'command' && event.isTrusted && event.key === 'Meta' && !event.repeat) schedule(pointed, 0)
  })
  document.addEventListener('keyup', event => { if (mode === 'command' && event.key === 'Meta') clear() })
  document.addEventListener('pointerout', event => { if (event.target === current) clear() })
  document.addEventListener('wheel', clear, { capture: true, passive: true })
  window.addEventListener('blur', clear)
  document.addEventListener('visibilitychange', () => { if (document.hidden) clear() })
}

export function allowWarmup(cover, warm) {
  if (enabled) covers.set(cover, warm)
}

export function finishWarmup(cover, keep) {
  covers.delete(cover)
  if (current !== cover) return
  if (keep) discard = null
  clear()
}
