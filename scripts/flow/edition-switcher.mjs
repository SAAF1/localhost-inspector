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
  function navigate(origin) {
    const address = new URL(location.pathname, origin)
    const { frame, route, expanded } = context()
    if (frame) {
      const hash = new URLSearchParams({ context: '1', frame: frame.id, page: route })
      if (expanded) hash.set('view', 'canvas')
      address.hash = hash.toString()
    } else address.searchParams.set('page', new URLSearchParams(location.search).get('page') || '/')
    // A different origin has its own journal. Its built-in editor is ready
    // without carrying an extension attachment across the origin boundary.
    location.assign(address)
  }
  select.add(new Option('Duplicate this design…', 'duplicate'))
  select.onchange = async () => {
    if (select.value !== 'duplicate') return navigate(select.value)
    select.value = location.origin
    select.disabled = true
    try {
      const response = await fetch('./duplicate-design', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
      const result = await response.json()
      if (!response.ok) throw Error(result.error)
      const next = new URL(result.origin)
      if (next.protocol !== 'http:' || next.hostname !== '127.0.0.1' || !next.port)
        throw Error('Invalid design location.')
      navigate(next.origin)
    } catch (error) {
      const notice = document.querySelector('#notice')
      if (notice) {
        notice.hidden = false
        notice.value = error.message
      }
      select.disabled = false
    }
  }
  toolbar.prepend(select)
}
