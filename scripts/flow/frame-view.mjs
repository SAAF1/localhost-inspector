import { matchesCheckpoint } from './replay.mjs'

export function framePresets(viewport) {
  return {
    desktop: { ...viewport, label: 'Desktop' },
    tablet: { width: 768, height: 1024, label: 'Tablet' },
    phone: { width: 390, height: 844, label: 'Phone' },
  }
}

export function sizeFrame(iframe, { width, height }) {
  Object.assign(iframe.style, { width: width + 'px', height: height + 'px' })
}

// Also runs in the capture browser. Measure without changing the app's DOM or styles.
export function contentOverflow(doc = document) {
  const root = doc?.scrollingElement
  if (!root) return 0
  const documentOverflow = root.scrollHeight - root.clientHeight
  if (documentOverflow > 1) return documentOverflow

  const main = doc.querySelector('main, [role="main"]') ?? doc.body
  const dialogs = [...doc.querySelectorAll('[role="dialog"], dialog[open]')]
    .filter(dialog => {
      if (!dialog.getClientRects().length) return false
      const style = doc.defaultView.getComputedStyle(dialog)
      return style.visibility === 'visible' &&
        (dialog.matches('dialog[open], [aria-modal="true"]') || style.position === 'fixed')
    })
  const scope = dialogs.at(-1) ?? main
  if (!scope) return 0
  const scrollers = [scope, ...scope.querySelectorAll('*')].filter(node => {
    if (node.clientHeight < 64 || node.clientWidth < 120 || node.scrollHeight - node.clientHeight < 3) return false
    const style = doc.defaultView.getComputedStyle(node)
    return /^(auto|scroll)$/.test(style.overflowY) && style.visibility === 'visible'
  })
  if (scrollers.length !== 1) return 0
  return scrollers[0].scrollHeight - scrollers[0].clientHeight
}

export async function growToContents(start, measure, resize) {
  let height = start
  let previous = Infinity
  for (let attempt = 0; attempt < 4; attempt++) {
    const overflow = await measure()
    if (!overflow) return height > start ? height : null
    if (overflow >= previous || height + overflow > 10000) return null
    previous = overflow
    height += overflow
    if (!(await resize(height))) return null
  }
  return null
}

function layoutReady() {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
}

export async function fitFrame(iframe, frame, view, preset, current) {
  const doc = iframe.contentDocument
  const resize = async height => {
    sizeFrame(iframe, { width: preset.width, height })
    await layoutReady()
    return current() && doc === iframe.contentDocument && matchesCheckpoint(doc, frame)
  }
  if (!(await resize(preset.height))) return null
  if (view.mode === 'fixed') return { ...preset, ...view }
  const height = await growToContents(preset.height, () => contentOverflow(doc), resize)
  return height ? { ...preset, ...view, height } : null
}
