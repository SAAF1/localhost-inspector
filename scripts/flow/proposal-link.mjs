// EventSource sends the current link on every connection, including reconnects.
export function watchProposalLink(updateComparison, updateOrigins) {
  let stream
  function connect() {
    stream = new EventSource('./proposal-events')
    stream.addEventListener('preview-origins', event => updateOrigins(JSON.parse(event.data)))
    stream.onmessage = event => updateComparison(JSON.parse(event.data))
  }
  connect()
  window.addEventListener('pagehide', () => stream.close())
  window.addEventListener('pageshow', event => { if (event.persisted) connect() })
}
