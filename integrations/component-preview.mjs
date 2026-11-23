// Development-only integration. Register on mount in the shared renderer and
// dispose on unmount. Slot writes must settle after the app commits its render.
const binding = Symbol.for('localhost-inspector.component.v1')
const marker = 'data-inspector-component'
const definitionMarker = 'data-inspector-component-definition'

function sameSlot(left, right) {
  return left.value === right.value && left.visible === right.visible
}

function rendered(root, element) {
  if (element == null) return false
  if (!(element instanceof Element) || !root.contains(element)) throw Error('Slot lives outside the component')
  return element.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
    element.getClientRects().length > 0
}

export function registerComponent(root, definition, instance) {
  if (root.hasAttribute(marker)) throw Error('Component already registered on this element')
  const id = crypto.randomUUID()
  const slots = definition.slots ?? []
  const properties = definition.properties ?? []
  const ids = [...slots, ...properties].map(field => field.id)
  if (new Set(ids).size !== ids.length) throw Error('Duplicate component field')
  let writing = false
  const mounted = () => root.isConnected && root.getAttribute(marker) === id && root[binding] === api

  function read(slot) {
    const { value, visible, unavailableReason, element, renderedValue } = instance.readSlot(slot.id)
    if (value !== null && !slot.options.some(option => option.value === value)) throw Error('Unknown slot value')
    if (typeof visible !== 'boolean' || (visible && value === null)) throw Error('Invalid slot visibility')
    return { value, visible, unavailableReason: unavailableReason || null, element, renderedValue }
  }

  function inspect() {
    if (!mounted()) return null
    return {
      id, name: definition.name, library: definition.library ?? '',
      properties: properties.map(({ id, label, kind, options }) => ({
        id, label, kind, options, value: instance.readProperty(id),
      })),
      slots: slots.map(slot => {
        const { value, visible, unavailableReason } = read(slot)
        return { id: slot.id, label: slot.label, options: slot.options, value, visible, unavailableReason }
      }),
    }
  }

  async function preview(slotId, before, requested) {
    const slot = slots.find(field => field.id === slotId)
    if (!slot || writing || !mounted()) return { status: 'unavailable' }
    const valid = state => state && typeof state.visible === 'boolean' &&
      (state.value === null ? !state.visible : slot.options.some(option => option.value === state.value))
    if (!valid(before) || !valid(requested)) return { status: 'invalid' }
    const initial = read(slot)
    if (initial.unavailableReason) return { status: 'unavailable', reason: initial.unavailableReason }
    // renderedValue identifies the content actually mounted in the slot.
    const confirms = (state, expected) => !state.unavailableReason && sameSlot(state, expected) &&
      rendered(root, state.element) === expected.visible && (!expected.visible || state.renderedValue === expected.value)
    if (!confirms(initial, before)) return { status: 'conflict' }
    if (sameSlot(before, requested)) return { status: 'applied' }

    writing = true
    try {
      const apply = state => instance.setSlot(slotId, { value: state.value, visible: state.visible })
      try {
        await apply(requested)
        if (mounted() && confirms(read(slot), requested)) return { status: 'applied' }
      } catch { /* The setter may have changed state before it failed. */ }
      if (!mounted()) return { status: 'unconfirmed' }
      const current = read(slot)
      if (confirms(current, before)) return { status: 'rejected' }
      if (current.unavailableReason || !sameSlot(current, requested)) return { status: 'unconfirmed' }
      await apply(before)
      return { status: mounted() && confirms(read(slot), before) ? 'rejected' : 'unconfirmed' }
    } catch {
      return { status: 'unconfirmed' }
    } finally {
      writing = false
    }
  }

  const api = { inspect, preview }
  root[binding] = api
  root.setAttribute(marker, id)
  if (typeof definition.name === 'string' && definition.name.trim()) {
    root.setAttribute(definitionMarker, JSON.stringify([definition.library ?? '', definition.name]))
  }
  return () => {
    if (root[binding] !== api) return
    delete root[binding]
    if (root.getAttribute(marker) === id) {
      root.removeAttribute(marker)
      root.removeAttribute(definitionMarker)
    }
  }
}
