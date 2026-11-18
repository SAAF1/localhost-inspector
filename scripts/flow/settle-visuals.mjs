// The snapshot stays visible while large SVG graphics finish their entrance.
export async function settleVisuals(doc = document, current = () => true) {
  const plots = [...doc.querySelectorAll('svg[role="application"], svg[role="img"]')]
    .filter(svg => svg.getBoundingClientRect().width >= 160)
  if (!plots.length) return
  let lastChange = performance.now()
  const started = lastChange
  const Observer = doc.defaultView.MutationObserver
  const observer = new Observer(() => { lastChange = performance.now() })
  for (const plot of plots) observer.observe(plot, { subtree: true, childList: true, attributes: true })
  try {
    while (current() && performance.now() - lastChange < 160 && performance.now() - started < 1800) {
      await new Promise(resolve => setTimeout(resolve, 40))
    }
  } finally {
    observer.disconnect()
  }
}
