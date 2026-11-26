import { useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'

// DOM events work between the isolated extension and the app's React runtime.
// Only the final value for a registered site is exposed to its subscribers.
const listeners = new Map()
const values = new Map()
document.addEventListener('li-prepared-input', (event) => {
  let request
  try {
    request = JSON.parse(event.detail)
  } catch {
    return
  }
  if (
    !/^[a-f0-9]{64}$/.test(request?.revision) ||
    (request.value !== null && !/^[a-zA-Z0-9_-]{1,60}$/.test(request.value))
  )
    return
  const { revision, field, value } = request
  if (field !== undefined && !/^[a-zA-Z][a-zA-Z0-9-]{0,59}$/.test(field)) return
  // Single-input sites subscribe to the original revision. Multi-input sites
  // subscribe independently so one field can be undone while the other stays.
  const channels = field ? [revision, revision + ':' + field] : [revision]
  const changed = channels.filter(channel => (values.get(channel) ?? null) !== value)
  if (!changed.length) return
  for (const channel of changed) {
    if (value == null) values.delete(channel)
    else values.set(channel, value)
  }
  flushSync(() => {
    for (const channel of changed) for (const notify of listeners.get(channel) ?? []) notify()
  })
})
document.dispatchEvent(new Event('li-prepared-ready'))
export function usePreparedInput(site, field) {
  const revision = field ? site + ':' + field : site
  return useSyncExternalStore(
    (notify) => {
      if (!listeners.has(revision)) listeners.set(revision, new Set())
      listeners.get(revision).add(notify)
      return () => {
        const current = listeners.get(revision)
        current.delete(notify)
        if (!current.size) listeners.delete(revision)
      }
    },
    () => values.get(revision) ?? null,
  )
}
