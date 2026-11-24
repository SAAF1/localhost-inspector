const nearViewport = 160
const maxImages = 4
const maxDecodedBytes = 48 * 1024 * 1024

export function restoreStandardPreview(card) {
  if (!card.sharpImage) return
  card.sharpImage.replaceWith(card.image)
  card.sharpImage = null
  card.updatePreviewState()
}

export function createSharpPreviews(cards) {
  const requests = new Map()
  const failed = new WeakMap()

  function clear(card) {
    const request = requests.get(card)
    requests.delete(card)
    restoreStandardPreview(card)
    request?.image.removeAttribute('src')
  }

  function load(card) {
    const file = card.sharpFile
    const image = new Image(card.image.width, card.image.height)
    image.alt = ''
    image.decoding = 'async'
    image.src = './' + file
    const request = { file, image }
    requests.set(card, request)
    void image.decode().then(() => {
      if (requests.get(card) !== request || card.sharpFile !== file) return
      card.image.replaceWith(image)
      card.sharpImage = image
      card.updatePreviewState()
    }).catch(() => {
      if (requests.get(card) !== request) return
      failed.set(card, file)
      clear(card)
    })
  }

  return function update(expanded, camera, width, height) {
    const density = camera.scale * window.devicePixelRatio
    const candidates = []
    if (expanded && density >= .6) {
      for (const card of cards.values()) {
        if (!card.sharpFile || failed.get(card) === card.sharpFile) continue
        if (density < .73 && requests.get(card)?.file !== card.sharpFile) continue
        const left = camera.x + card.x * camera.scale
        const top = camera.y + (card.y + card.labelHeight) * camera.scale
        const right = left + card.width * camera.scale
        const bottom = top + card.image.height * camera.scale
        if (right < -nearViewport || left > width + nearViewport ||
            bottom < -nearViewport || top > height + nearViewport) continue
        const visibleWidth = Math.max(0, Math.min(right, width) - Math.max(left, 0))
        const visibleHeight = Math.max(0, Math.min(bottom, height) - Math.max(top, 0))
        candidates.push({ card, area: visibleWidth * visibleHeight, bytes: card.image.width * card.image.height * 16 })
      }
    }
    candidates.sort((a, b) => b.area - a.area)
    const wanted = new Set()
    let bytes = 0
    for (const candidate of candidates) {
      if (wanted.size === maxImages) break
      if (bytes + candidate.bytes > maxDecodedBytes) continue
      wanted.add(candidate.card)
      bytes += candidate.bytes
    }
    for (const [card, request] of requests) {
      if (!wanted.has(card) || request.file !== card.sharpFile) clear(card)
    }
    for (const card of wanted) if (!requests.has(card)) load(card)
  }
}
