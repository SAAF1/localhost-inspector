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
  const { revision, value } = request
  if (values.get(revision) === value) return
  if (value == null) values.delete(revision)
  else values.set(revision, value)
  flushSync(() => {
    for (const notify of listeners.get(revision) ?? []) notify()
  })
})
document.dispatchEvent(new Event('li-prepared-ready'))
export function usePreparedInput(revision) {
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
