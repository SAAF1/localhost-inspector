// Keep the candidate and its editor alive while showing the studio's Original.
export function mountSourceCompare(baseline, currentFrame) {
  const origin = baseline.origin
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin) || origin === location.origin) return
  let close
  window.addEventListener('message', async event => {
    const frame = currentFrame()
    const { type, before, requestId } = event.data ?? {}
    if (type !== 'inspector-authored-compare' || event.origin !== location.origin ||
        event.source !== frame.contentWindow || typeof before !== 'boolean' || typeof requestId !== 'string') return
    const reply = (ok, reason) => event.source.postMessage({type:'inspector-authored-compare-result', requestId, ok, reason}, event.origin)
    close?.()
    if (!before) return reply(true)
    const route = new URL(frame.contentWindow.location.href)
    const original = document.createElement('iframe')
    original.title = 'Before · Original source'
    original.name = 'inspector-source-original'
    original.id = 'authored-source-original'
    original.tabIndex = -1
    original.inert = true
    Object.assign(original.style, {position:'fixed', border:'0', background:'white', transformOrigin:'top left', pointerEvents:'none'})
    const sync = () => {
      const rect = frame.getBoundingClientRect()
      Object.assign(original.style,{left:rect.left+'px', top:rect.top+'px', width:frame.offsetWidth+'px', height:frame.offsetHeight+'px',
        transform:'scale('+rect.width/frame.offsetWidth+','+rect.height/frame.offsetHeight+')'})
    }
    const bounds = new ResizeObserver(sync)
    let settled = false
    const finish = (ok, reason) => { if (!settled) { settled = true; reply(ok, reason) } }
    const ready = message => {
      if (message.source !== original.contentWindow || message.origin !== origin ||
          message.data?.type !== 'inspector-original-ready' || message.data.requestId !== requestId) return
      if (message.data.basis !== baseline.basis) return close()
      clearTimeout(timer)
      original.style.visibility = 'visible'
      frame.inert = true
      finish(true)
    }
    const timer = setTimeout(() => close?.(), 7000)
    close = () => {
      clearTimeout(timer)
      bounds.disconnect()
      removeEventListener('message', ready)
      removeEventListener('scroll', sync, true)
      frame.removeEventListener('load', onNavigation)
      frame.inert = false
      original.remove()
      close = null
      finish(false,'The original source or frame is unavailable.')
    }
    const onNavigation = close
    frame.addEventListener('load', onNavigation, {once:true})
    addEventListener('message', ready)
    addEventListener('scroll', sync, true)
    original.style.visibility = 'hidden'
    original.addEventListener('load', () => original.contentWindow.postMessage({type:'inspector-original-basis',requestId}, origin))
    original.src = origin + route.pathname + route.search + route.hash
    frame.after(original)
    bounds.observe(frame)
    sync()
  })
}
