(() => {
  const ui = window.LocalhostInspector
  let pending
  let marker
  let cancelExpiration = () => {}

  function clearMarker() {
    marker?.remove()
    marker = undefined
    cancelExpiration()
    cancelExpiration = () => {}
  }
  window.addEventListener('pagehide', clearMarker)

  const rect = element => {
    const { left, top, right, bottom } = element.getBoundingClientRect()
    return { left, top, right, bottom }
  }

  function captureGeometry(node, panel, owner) {
    const viewport = owner.defaultView
    if (owner.hidden || viewport.visualViewport?.scale !== 1) return null
    let target = rect(node)
    let clip = null
    if (owner !== document) {
      const frame = window.frameElement
      const viewportNode = owner.getElementById('viewport')
      if (!frame?.isConnected || frame !== owner.getElementById('app-preview') ||
          frame.parentElement !== viewportNode || frame.contentDocument !== document ||
          frame.clientWidth !== innerWidth || frame.clientHeight !== innerHeight ||
          !innerWidth || !innerHeight) return null
      const bounds = rect(frame)
      const area = rect(viewportNode)
      const scaleX = (bounds.right - bounds.left) / innerWidth
      const scaleY = (bounds.bottom - bounds.top) / innerHeight
      if (scaleX <= 0 || Math.abs(scaleX - scaleY) > 0.01) return null
      target = {
        left: bounds.left + target.left * scaleX, right: bounds.left + target.right * scaleX,
        top: bounds.top + target.top * scaleY, bottom: bounds.top + target.bottom * scaleY,
      }
      clip = {
        left: Math.max(bounds.left, area.left), top: Math.max(bounds.top, area.top),
        right: Math.min(bounds.right, area.right), bottom: Math.min(bounds.bottom, area.bottom),
      }
      if (owner.elementFromPoint((target.left + target.right) / 2, (target.top + target.bottom) / 2) !== frame) return null
    }
    return { width: viewport.innerWidth, height: viewport.innerHeight, target, clip, panel: rect(panel) }
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
      const owner = pending.owner
      const canvas = owner.createElement('canvas')
      canvas.width = 16
      canvas.height = 8
      const context = canvas.getContext('2d')
      for (let index = 0; index < 32; index++) {
        context.fillStyle = (proof.nonce >>> index) & 1 ? '#fff' : '#000'
        context.fillRect(index % 8 * 2, Math.floor(index / 8) * 2, 2, 2)
      }
      marker = owner.createElement('div')
      marker.style.cssText = 'all:initial;position:fixed;pointer-events:none;z-index:2147483647;left:' +
        proof.x + 'px;top:' + proof.y + 'px;width:16px;height:8px'
      const shadow = marker.attachShadow({ mode: 'closed' })
      canvas.style.cssText = 'display:block;width:16px;height:8px;image-rendering:pixelated'
      shadow.append(canvas)
      owner.documentElement.append(marker)
      const viewport = owner.defaultView
      const timer = viewport.setTimeout(clearMarker, 1200)
      cancelExpiration = () => viewport.clearTimeout(timer)
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
    const owner = panel.ownerDocument
    const geometry = () => {
      if (document.hidden || panel.hidden || !stillCurrent() || !node.isConnected || window.visualViewport?.scale !== 1) return null
      return captureGeometry(node, panel, owner)
    }
    const initial = geometry()
    if (!initial) return
    const targetKey = ({ width, height, target, clip }) => JSON.stringify([width, height, target, clip])
    const initialKey = targetKey(initial)
    let captureKey
    pending = {
      id: edit.id, owner,
      geometry: () => {
        const current = geometry()
        if (!current || targetKey(current) !== initialKey) return null
        // Saving can change the footer height before the browser starts framing.
        // From that first probe onward, keep the crop and the panel position fixed.
        const key = JSON.stringify(current)
        captureKey ??= key
        return key === captureKey ? current : null
      },
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
