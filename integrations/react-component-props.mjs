// Virtual module in a disposable Inspector build. Each override belongs to a
// single mounted instance and disappears on reset, unmount, or document reload.
import { isValidElement, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { flushSync } from 'react-dom'

const mounted = Symbol.for('localhost-inspector.mounted-props.v1')
const requestEvent = 'localhost-inspector-component-props'
const responseEvent = 'localhost-inspector-component-result'
function registryForPage() {
  if (window[mounted]) return window[mounted]
  const registry = new Map()
  window[mounted] = registry
  // A DOM request crosses Chrome's isolated world without serializing React
  // internals or depending on a service worker from a previous extension build.
  document.addEventListener(requestEvent, event => {
    if (!(event.target instanceof Element) || typeof event.detail !== 'string') return
    let request
    try { request = JSON.parse(event.detail) } catch { return }
    const node = event.target
    if (!request || typeof request !== 'object') return
    const { id, source, key, before, requested, reset } = request
    const api = registry.get(id)
    if (!api || api.source !== source || node.getAttribute('data-inspector-instance') !== id ||
        node.getAttribute('data-inspector-source') !== source ||
        document.querySelectorAll('[data-inspector-instance="' + CSS.escape(id) + '"]').length !== 1) return
    const result = request.type === 'inspect' ? api.inspect() :
      request.type === 'preview' && api.preview(key, before, requested, reset === true)
    node.dispatchEvent(new CustomEvent(responseEvent, { detail: JSON.stringify(result) }))
  })
  return registry
}
const primitive = value => ['boolean', 'number', 'string'].includes(typeof value)

// Summarize JSX without rendering it or invoking user-provided functions.
function contentLabel(raw) {
  const pieces = []
  let visited = 0
  function visit(value) {
    if (++visited > 32 || pieces.length >= 8 || value == null || typeof value === 'boolean') return
    if (typeof value === 'string' || typeof value === 'number') { pieces.push(String(value).slice(0, 80)); return }
    if (Array.isArray(value)) {
      for (const child of value.slice(0, 16)) visit(child)
    } else if (isValidElement(value)) {
      const content = value.props?.['aria-label'] || value.props?.children
      if (content != null) visit(content)
      else if (value.type?.displayName) pieces.push(value.type.displayName)
    }
  }
  visit(raw)
  return pieces.join(' ').replace(/\s+/g, ' ').trim().slice(0, 160) || 'Provided'
}

export function useComponentPreview(schema, incoming) {
  const [id] = useState(() => crypto.randomUUID())
  const [, redraw] = useReducer(count => count + 1, 0)
  const overrides = useRef(new Map()).current
  const source = JSON.stringify([schema.source, schema.name])
  let props = incoming
  for (const [key, item] of overrides) {
    if (!Object.is(incoming[key], item.base)) continue
    if (props === incoming) props = { ...incoming }
    props[key] = item.value
  }
  useLayoutEffect(() => {
    for (const [key, item] of overrides) if (!Object.is(incoming[key], item.base)) overrides.delete(key)
    const registry = registryForPage()
    function inspect() {
      return { id, source, name: schema.name, properties: schema.fields.map(key => {
        const raw = props[key] === undefined ? schema.defaults?.[key] : props[key]
        const value = raw === undefined ? 'Not supplied' : raw === null ? 'None' :
          primitive(raw) ? raw : contentLabel(raw)
        return { id: key, value: typeof value === 'string' ? value.slice(0, 160) : value,
          options: schema.options?.[key] ?? [], overridden: overrides.has(key) }
      }) }
    }
    const api = { source, inspect, preview(key, before, requested, reset) {
      const options = schema.options?.[key]
      const previous = overrides.get(key)
      if (!options?.length || !(reset ? previous : options.includes(requested))) return false
      if (!Object.is(inspect().properties.find(p => p.id === key)?.value, before)) return false
      const base = incoming[key] === undefined ? schema.defaults?.[key] : incoming[key]
      if (reset || Object.is(requested, base)) overrides.delete(key)
      else overrides.set(key, { base: incoming[key], value: requested })
      flushSync(redraw)
      const updated = registry.get(id)?.inspect().properties.find(p => p.id === key)
      const liveRoots = document.querySelectorAll('[data-inspector-instance="' + CSS.escape(id) + '"]')
      if (liveRoots.length === 1 && updated && (reset ? !updated.overridden : Object.is(updated.value, requested))) return true
      if (previous) overrides.set(key, previous)
      else overrides.delete(key)
      if (registry.has(id)) flushSync(redraw)
      return false
    } }
    registry.set(id, api)
    return () => { if (registry.get(id) === api) registry.delete(id) }
  })
  return { id, source, props }
}
