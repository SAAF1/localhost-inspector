export function mountEditionSwitcher(toolbar, versions, context) {
  if (!Array.isArray(versions) || versions.length < 2) return
  const select = document.createElement('select')
  select.setAttribute('aria-label', 'Design version')
  const origins = new Set()
  for (const { label, origin } of versions) {
    let url
    try {
      url = new URL(origin)
    } catch {
      return
    }
    if (
      url.protocol !== 'http:' ||
      url.hostname !== '127.0.0.1' ||
      url.origin !== origin ||
      !url.port ||
      typeof label !== 'string' ||
      origins.has(origin)
    )
      return
    origins.add(origin)
    select.add(new Option(label, origin, false, origin === location.origin))
  }
  if (!origins.has(location.origin)) return
  select.onchange = () => {
    const address = new URL(location.pathname, select.value)
    const { frame, route, expanded } = context()
    if (frame) {
      const hash = new URLSearchParams({ context: '1', frame: frame.id, page: route })
      if (expanded) hash.set('view', 'canvas')
      address.hash = hash.toString()
    } else address.search = location.search
    // A different origin has its own journal. Its built-in editor is ready
    // without carrying an extension attachment across the origin boundary.
    location.assign(address)
  }
  toolbar.prepend(select)
}
