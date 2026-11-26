// EventSource sends the current link on every connection, including reconnects.
export function watchProposalLink(updateComparison, updateOrigins, updateActivity, onDemand = false, knownVersion) {
  let stream
  function connect() {
    let path = './proposal-events'
    if (onDemand) {
      path += '?previewOrigins=on-demand'
      if (knownVersion) path += '&knownVersion=' + encodeURIComponent(knownVersion)
    }
    stream = new EventSource(path)
    stream.addEventListener('catalog', event => {
      const payload = JSON.parse(event.data)
      updateOrigins(payload)
      updateActivity(payload)
      knownVersion = event.lastEventId
    })
    stream.addEventListener('preview-origins', event => updateOrigins(JSON.parse(event.data)))
    if (updateActivity) stream.addEventListener('activity', event => updateActivity(JSON.parse(event.data)))
    stream.onmessage = event => updateComparison(JSON.parse(event.data))
  }
  connect()
  window.addEventListener('pagehide', () => stream.close())
  window.addEventListener('pageshow', event => { if (event.persisted) connect() })
}
