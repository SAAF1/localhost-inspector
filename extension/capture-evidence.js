const maxImageLength = 140_000
const minCaptureInterval = 600
const captureStepTimeout = 500
const proofWidth = 16
const proofHeight = 8
let capturing = false
let lastCapture = 0
let activation = 0
chrome.tabs.onActivated.addListener(() => { activation++ })

function rectIntersects(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

function cropAroundTarget({ width, height, target, panel, clip }) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 32 || height < 32) return null
  if (!Object.values(target).every(Number.isFinite)) return null
  if (target.left < 0 || target.top < 0 || target.right > width || target.bottom > height ||
      target.right <= target.left || target.bottom <= target.top) return null
  if (clip && (target.left < clip.left || target.top < clip.top || target.right > clip.right ||
      target.bottom > clip.bottom)) return null
  const crop = {
    left: Math.max(0, Math.ceil(clip?.left ?? 0), Math.floor(target.left - 175)),
    top: Math.max(0, Math.ceil(clip?.top ?? 0), Math.floor(target.top - 175)),
    right: Math.min(width, Math.floor(clip?.right ?? width), Math.ceil(target.right + 175)),
    bottom: Math.min(height, Math.floor(clip?.bottom ?? height), Math.ceil(target.bottom + 132)),
  }
  // Keep the inspector itself out of the evidence. If it covers the selected
  // element, a crop cannot establish what the user was looking at.
  if (panel && rectIntersects(crop, panel)) {
    if (rectIntersects(target, panel)) return null
    if (target.right <= panel.left) crop.right = Math.floor(panel.left)
    else if (target.bottom <= panel.top) crop.bottom = Math.floor(panel.top)
    else if (target.left >= panel.right) crop.left = Math.ceil(panel.right)
    else crop.top = Math.ceil(panel.bottom)
  }
  if (crop.right <= crop.left || crop.bottom <= crop.top) return null
  const proof = [
    [width - proofWidth, height - proofHeight], [width - proofWidth, 0], [0, height - proofHeight], [0, 0],
  ].find(([x, y]) => !rectIntersects(crop, { left: x, top: y, right: x + proofWidth, bottom: y + proofHeight }))
  if (!proof) return null
  const nonce = crypto.getRandomValues(new Uint32Array(1))[0]
  return { crop, proof: { x: proof[0], y: proof[1], nonce } }
}

async function withinCaptureStep(promise) {
  let timer
  try {
    return await Promise.race([promise, new Promise((resolve) => { timer = setTimeout(resolve, captureStepTimeout) })])
  } finally {
    clearTimeout(timer)
  }
}

async function probe(tabId, documentId, id, action, proof) {
  const [result] = await withinCaptureStep(chrome.scripting.executeScript({
    target: { tabId, documentIds: [documentId] },
    func: (id, action, proof) => window.LocalhostInspector?.probeEditEvidence?.(id, action, proof),
    args: [id, action, proof ?? null],
  })) ?? []
  return result?.result
}

function proofMatches(bitmap, scaleX, scaleY, { x, y, nonce }) {
  const left = Math.floor(x * scaleX)
  const top = Math.floor(y * scaleY)
  const width = Math.ceil(proofWidth * scaleX)
  const height = Math.ceil(proofHeight * scaleY)
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, left, top, width, height, 0, 0, width, height)
  const pixels = ctx.getImageData(0, 0, width, height).data
  for (let index = 0; index < 32; index++) {
    const px = Math.floor((x + index % 8 * 2 + 1) * scaleX) - left
    const py = Math.floor((y + Math.floor(index / 8) * 2 + 1) * scaleY) - top
    if (px < 0 || px >= width || py < 0 || py >= height || left + px >= bitmap.width || top + py >= bitmap.height) return false
    const expectedLight = (nonce >>> index) & 1
    const offset = (py * width + px) * 4
    if (pixels[offset + 3] !== 255) return false
    for (let channel = 0; channel < 3; channel++) {
      if (expectedLight ? pixels[offset + channel] < 220 : pixels[offset + channel] > 35) return false
    }
  }
  return true
}

async function encodeCrop(url, geometry, { crop, proof }) {
  const bitmap = await createImageBitmap(await (await fetch(url)).blob())
  try {
    const scaleX = bitmap.width / geometry.width
    const scaleY = bitmap.height / geometry.height
    if (scaleX < 0.8 || scaleY < 0.8 || Math.abs(scaleX - scaleY) > 0.02 ||
        !proofMatches(bitmap, scaleX, scaleY, proof)) return undefined
    const width = crop.right - crop.left
    const height = crop.bottom - crop.top
    for (const factor of [1, 0.65]) {
      const scale = Math.min(1, 800 / width, 640 / height) * factor
      const canvas = new OffscreenCanvas(Math.ceil(width * scale), Math.ceil(height * scale))
      const ctx = canvas.getContext('2d')
      ctx.drawImage(bitmap, crop.left * scaleX, crop.top * scaleY, width * scaleX, height * scaleY,
        0, 0, canvas.width, canvas.height)
      const { target } = geometry
      ctx.strokeStyle = '#1675ec'
      ctx.lineWidth = 2
      ctx.strokeRect((target.left - crop.left) * scale, (target.top - crop.top) * scale,
        (target.right - target.left) * scale, (target.bottom - target.top) * scale)
      const blob = await canvas.convertToBlob({ type: 'image/png' })
      if (Math.ceil(blob.size / 3) * 4 > maxImageLength) continue
      const bytes = new Uint8Array(await blob.arrayBuffer())
      let binary = ''
      for (let offset = 0; offset < bytes.length; offset += 8192) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
      }
      return btoa(binary)
    }
  } finally {
    bitmap.close()
  }
}

export async function captureEditEvidence(sender, id) {
  if (capturing || Date.now() - lastCapture < minCaptureInterval) return undefined
  const { id: tabId, windowId } = sender.tab
  const { documentId } = sender
  if (typeof documentId !== 'string') return undefined
  capturing = true
  const started = activation
  const active = async () => {
    const tab = await chrome.tabs.get(tabId)
    return tab.active && tab.windowId === windowId && activation === started
  }
  try {
    if (!await active()) return undefined
    const geometry = await probe(tabId, documentId, id, 'read')
    const framing = geometry && cropAroundTarget(geometry)
    if (!framing || !await probe(tabId, documentId, id, 'mark', framing.proof) || !await active()) return undefined
    lastCapture = Date.now()
    const url = await withinCaptureStep(chrome.tabs.captureVisibleTab(windowId, { format: 'png' }))
    if (!url || !await active() || !await probe(tabId, documentId, id, 'read')) return undefined
    return await encodeCrop(url, geometry, framing)
  } finally {
    await probe(tabId, documentId, id, 'clear').catch(() => {})
    capturing = false
  }
}
