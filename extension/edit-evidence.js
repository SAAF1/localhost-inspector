(() => {
  const ui = window.LocalhostInspector
  let pending
  let marker
  let expiration

  function clearMarker() {
    marker?.remove()
    marker = undefined
    clearTimeout(expiration)
  }

  ui.probeEditEvidence = async (id, action, proof) => {
    if (pending?.id !== id) return null
    if (action === 'clear') {
      clearMarker()
      return null
    }
    const geometry = pending.geometry()
    if (!geometry) return null
    if (action === 'mark') {
      clearMarker()
      const canvas = document.createElement('canvas')
      canvas.width = 16
      canvas.height = 8
      const context = canvas.getContext('2d')
      for (let index = 0; index < 32; index++) {
        context.fillStyle = (proof.nonce >>> index) & 1 ? '#fff' : '#000'
        context.fillRect(index % 8 * 2, Math.floor(index / 8) * 2, 2, 2)
      }
      marker = document.createElement('div')
      marker.style.cssText = 'all:initial;position:fixed;pointer-events:none;z-index:2147483647;left:' +
        proof.x + 'px;top:' + proof.y + 'px;width:16px;height:8px'
      const shadow = marker.attachShadow({ mode: 'closed' })
      canvas.style.cssText = 'display:block;width:16px;height:8px;image-rendering:pixelated'
      shadow.append(canvas)
      document.documentElement.append(marker)
      expiration = setTimeout(clearMarker, 1200)
      const painted = await new Promise(resolve => {
        const fallback = setTimeout(() => resolve(false), 180)
        requestAnimationFrame(() => requestAnimationFrame(() => {
          clearTimeout(fallback)
          resolve(true)
        }))
      })
      if (!painted || !marker?.isConnected || !pending?.geometry()) return null
    }
    return geometry
  }

  ui.captureEditEvidence = (node, panel, edit, stillCurrent) => {
    if (pending || document.hidden || panel.hidden) return
    const rect = element => {
      const { left, top, right, bottom } = element.getBoundingClientRect()
      return { left, top, right, bottom }
    }
    const geometry = () => {
      if (document.hidden || panel.hidden || !stillCurrent() || !node.isConnected || window.visualViewport?.scale !== 1) return null
      return {
        width: innerWidth,
        height: innerHeight,
        target: rect(node),
        panel: panel.ownerDocument === document && !panel.hidden ? rect(panel) : null,
      }
    }
    const initial = geometry()
    if (!initial) return
    const initialKey = JSON.stringify(initial)
    pending = {
      id: edit.id,
      geometry: () => JSON.stringify(geometry()) === initialKey ? initial : null,
    }
    const clear = () => {
      if (pending?.id !== edit.id) return
      clearMarker()
      pending = undefined
    }
    const timer = setTimeout(clear, 2000)
    void window.phaseABridge({ type: 'captureEditEvidence', id: edit.id, route: edit.route })
      .catch(() => {})
      .finally(() => { clearTimeout(timer); clear() })
  }
})()
