export async function requestInspector(endpoint, message, signal) {
  const timeout = AbortSignal.timeout(5000)
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(message), signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
  })
  const result = await response.json()
  if (!response.ok || !result.ok) throw Object.assign(Error(result.error || 'The inspector request failed'), { code: result.code })
  return result.value
}

const pendingWorkspaceWrites = new Set()
const workspaceEndpoint = '/__inspector-flow/workspace-inspector'
export function prepareWorkspaceInspector() {
  const reads = new Map()
  const controller = new AbortController()
  let routeKey
  function queue(message, writes) {
    const key = JSON.stringify(message)
    // A superseded navigation may never consume its reads. Retry a failed
    // speculative request through the normal bridge when the editor opens.
    const read = () => requestInspector(workspaceEndpoint, message, controller.signal)
    const pending = writes?.length ? Promise.allSettled(writes).then(read) : read()
    reads.set(key, pending.then(value => ({ value }), () => null))
    return key
  }
  for (const type of ['colorCatalog', 'spacingCatalog', 'textStyleCatalog', 'fontFamilyCatalog']) queue({ type })
  return {
    cancel() {
      controller.abort()
      reads.clear()
    },
    async write(message) {
      // The workspace owns a save even if its app iframe is replaced mid-request.
      const write = requestInspector(workspaceEndpoint, message)
      pendingWorkspaceWrites.add(write)
      try { return await write } finally { pendingWorkspaceWrites.delete(write) }
    },
    loadRoute(address) {
      const { pathname, search, hash } = address
      routeKey = queue({ type: 'load', route: pathname + search + (/^#!?\//.test(hash) ? hash : '') }, [...pendingWorkspaceWrites])
    },
    take(message) {
      const key = JSON.stringify(message)
      const pending = reads.get(key)
      reads.delete(key)
      // A redirect during startup must discard the old route snapshot even
      // if the user later navigates back to that route in the same document.
      if (message.type === 'load' && routeKey) {
        reads.delete(routeKey)
        routeKey = undefined
      }
      return pending
    },
  }
}
