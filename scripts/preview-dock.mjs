const dockShell = `<!doctype html>
<html lang="en">
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Application preview</title>
  <style>
    body { position: fixed; inset: 0; display: grid; grid-template-columns: minmax(0, 1fr) auto; margin: 0; }
    #app-preview { display: block; width: 100%; height: 100%; border: 0; }
  </style>
  <body>
    <iframe id="app-preview" title="Application preview"></iframe>
    <div id="localhost-inspector-dock"></div>
    <script>
      const preview = document.getElementById('app-preview')
      preview.addEventListener('load', () => {
        if (preview.contentDocument?.title) document.title = preview.contentDocument.title
      })
      preview.src = location.href
    </script>
  </body>
</html>`

// Send the shell for a browser navigation. Frame requests still reach the app.
export function servePreviewDock(request, response, origin) {
  if (request.method !== 'GET' || request.headers['sec-fetch-dest'] !== 'document' ||
      request.headers.host !== new URL(origin).host) return false
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
  response.end(dockShell)
  return true
}

// Run in the app document before the inspector mounts. The frame owns the
// actual app navigation and history. Mirror its URL without adding steps.
export function connectPreviewDock() {
  const dock = window.frameElement?.nextElementSibling
  if (dock?.id !== 'localhost-inspector-dock') return
  window.localhostInspectorDock = dock
  const outer = dock.ownerDocument.defaultView
  function syncUrl() {
    if (outer.location.href !== location.href) outer.history.replaceState(outer.history.state, '', location.href)
  }
  for (const method of ['pushState', 'replaceState']) {
    const change = history[method].bind(history)
    history[method] = (...args) => {
      const result = change(...args)
      syncUrl()
      return result
    }
  }
  window.addEventListener('popstate', syncUrl)
  window.addEventListener('hashchange', syncUrl)
  window.addEventListener('pageshow', syncUrl)
  syncUrl()
}
