// Compare the visible swatch on each backdrop, including its own opacity.
function contrastOn(channels, gray) {
  const alpha = channels[3] / 255
  function linear(byte) {
    const s = byte / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = channels.slice(0, 3).map(channel => linear(channel * alpha + gray * (1 - alpha)))
  const ink = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const surface = linear(gray)
  return (Math.max(ink, surface) + 0.05) / (Math.min(ink, surface) + 0.05)
}

// Paint each audited property independently. Dimming a whole card with
// opacity would also dim matching text or borders inside it.
export function isolateColor(doc, entries, selectedId, channels) {
  const effects = []
  const paints = new Map()
  const selected = entries.find(entry => entry.id === selectedId)
  const liveHits = selected?.occurrences.filter(hit => hit.node?.ownerDocument === doc && hit.node.isConnected)
  if (!liveHits?.length) return
  const selectedFills = new Set(liveHits.filter(hit => hit.property === 'background-color')
    .map(hit => hit.node))
  function coversSelectedFill(node) {
    for (let parent = node.parentElement || node.getRootNode().host; parent; parent = parent.parentElement || parent.getRootNode().host) {
      if (selectedFills.has(parent)) return true
    }
    return false
  }
  const gray = contrastOn(channels, 22) > contrastOn(channels, 248) ? 22 : 248
  const neutral = 'rgb(' + [gray, gray, gray].join(' ') + ')'
  const faded = value => 'color-mix(in srgb, ' + value + ' 10%, rgb(from ' + value + ' ' + [gray, gray, gray].join(' ') + ' / alpha))'
  // Decorative gradients and shadows would otherwise remain at full contrast.
  const sheet = new doc.defaultView.CSSStyleSheet()
  sheet.replaceSync('*,*::before,*::after { background-image:none!important; box-shadow:none!important; text-shadow:none!important }')
  doc.adoptedStyleSheets.push(sheet)
  function paint(node, property, value) {
    if (!paints.has(node)) paints.set(node, {})
    paints.get(node)[property] = value
  }
  function apply(node, keyframe, pseudoElement) {
    const effect = new KeyframeEffect(node, [keyframe, keyframe], { duration: 1, fill: 'both', pseudoElement })
    const animation = new Animation(effect, doc.timeline)
    animation.currentTime = 0
    effects.push(animation)
  }

  paint(doc.documentElement, 'backgroundColor', neutral)
  for (const entry of entries) {
    if (entry.category !== 'color') continue
    const color = entry.id === selectedId ? entry.value : faded(entry.value)
    for (const { node, property, edges } of entry.occurrences) {
      if (!node?.isConnected || node.ownerDocument !== doc) continue
      // Opaque descendants can completely conceal a selected ancestor's fill.
      // Fade their paint independently so their text and borders keep their own preview.
      if (property === 'background-color' && entry.id !== selectedId && coversSelectedFill(node)) {
        paint(node, 'backgroundColor', 'color-mix(in srgb, ' + color + ' 10%, transparent)')
      } else if (property === 'placeholder-color') apply(node, { color }, '::placeholder')
      else if (property === 'border-color') {
        for (const side of edges) paint(node, 'border' + side[0].toUpperCase() + side.slice(1) + 'Color', color)
      } else paint(node, property === 'background-color' ? 'backgroundColor' : 'color', color)
    }
  }
  for (const node of doc.querySelectorAll('img,video,canvas,svg')) {
    if (!node.closest('#localhost-inspector,#localhost-inspector-outlines')) paint(node, 'opacity', '0.10')
  }
  for (const [node, keyframe] of paints) apply(node, keyframe)
  return () => {
    for (const effect of effects) effect.cancel()
    doc.adoptedStyleSheets = doc.adoptedStyleSheets.filter(item => item !== sheet)
  }
}
