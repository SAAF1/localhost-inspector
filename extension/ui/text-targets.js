(() => {
  const ui = window.LocalhostInspector
  const textElement = 'h1,h2,h3,h4,h5,h6,p,span,strong,b,em,i,small,mark,code,s,sub,sup'
  const labelControl = 'button,a[href],label,[role="button"],[role="link"]'
  const nonText = 'table,thead,tbody,tfoot,tr,svg,img,canvas,video,audio,picture,object,embed,iframe,input,select,textarea,progress,meter,hr,[role="checkbox"],[role="switch"],[role="radio"],[role="img"]'
  // An avatar is a visual component even when its image falls back to initials.
  const visualComponent = '[data-slot="avatar"],[data-slot="avatar-fallback"]'
  const skipped = 'script,style,template,noscript,br,wbr,[hidden]'

  function visuallyHidden(node, style) {
    if (node.matches(skipped) || style.display === 'none' || style.visibility !== 'visible' ||
        style.contentVisibility === 'hidden' || style.opacity === '0') return true
    // Visually hidden label helpers often have real text but no visible run.
    return style.position === 'absolute' && parseFloat(style.width) <= 1 && parseFloat(style.height) <= 1 &&
      (style.clip !== 'auto' || style.clipPath !== 'none')
  }

  ui.textTargets = root => {
    const control = root.matches(labelControl)
    function collect(node, style) {
      if (visuallyHidden(node, style)) return []
      if (control && node !== root && node.matches('svg,img[alt=""]')) return []
      if (node.matches(nonText) || (node !== root && node.matches(labelControl + ',' + visualComponent))) return null
      const directText = Array.from(node.childNodes).some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim())
      const targets = []
      let blockChildren = false
      for (const child of node.children) {
        const childStyle = getComputedStyle(child)
        const childTargets = collect(child, childStyle)
        if (!childTargets) return null
        if (!childTargets.length) continue
        targets.push(...childTargets)
        if (!childStyle.display.startsWith('inline') && childStyle.display !== 'contents') blockChildren = true
      }
      if (!directText && !targets.length) return null
      if (node === root && control) return directText || targets.length > 1 ? [node] : targets
      if (directText || (!blockChildren && node.matches(textElement))) {
        return blockChildren ? null : [node]
      }
      return targets
    }
    return collect(root, getComputedStyle(root)) ?? []
  }

  ui.textStyleValue = (style, property) => {
    const value = style.getPropertyValue(property).trim()
    if (property === 'text-align') {
      if (value === 'start') return style.direction === 'rtl' ? 'right' : 'left'
      if (value === 'end') return style.direction === 'rtl' ? 'left' : 'right'
    }
    return value
  }
})()
