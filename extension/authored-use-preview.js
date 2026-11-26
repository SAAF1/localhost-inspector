;(() => {
  const ui = window.LocalhostInspector
  const attribute = 'data-li-authored-use'
  const selector = '[' + attribute + ']'
  const flexPosition = { 'flow-start': 'flex-start', 'flow-end': 'flex-end' }
  const spacingProperties = ['gap', 'justify-content']

  function binding(node) {
    try {
      const value = JSON.parse(node?.getAttribute(attribute))
      const actions = value?.schema === 2 ? value.actions : value?.schema === 1 ? [value.family] : []
      if (Array.isArray(actions) && actions.length && actions.every(action => ['paint', 'spacing'].includes(action)) &&
          typeof value.id === 'string' && value.tag === node.localName && typeof value.revision === 'string') return value
    } catch {
      // The page can contain ordinary elements or unsupported markers.
    }
  }

  function visible(node) {
    return node.isConnected && node.getClientRects().length && getComputedStyle(node).visibility === 'visible'
  }

  function members(use, visibleOnly = true) {
    return [...document.querySelectorAll(selector)].filter(node => binding(node)?.id === use.id && (!visibleOnly || visible(node)))
  }

  function samePreparedUse(node, use, prepared) {
    if (use.file !== prepared.file) return false
    const expected = new Set(members(use, false))
    const candidates = ui.preparedPreview.membersOf(prepared.revision)
    const opening = use.id + ' ' + prepared.revision
    return expected.has(node) && candidates.length === expected.size && [...candidates].every(member =>
      expected.has(member) && binding(member)?.revision === use.revision &&
      member.getAttribute('data-li-shared-opening') === opening)
  }

  function read(node, family) {
    const style = getComputedStyle(node)
    return Object.fromEntries((family === 'paint' ? ['color'] : spacingProperties)
      .map(property => {
        const value = style.getPropertyValue(property)
        return [property, property === 'justify-content' ? flexPosition[value] ?? value : value]
      }))
  }

  function intent(node, use, property, value) {
    if (use.family === 'paint' && property === 'color') return { color: value }
    if (use.family !== 'spacing') return
    if (property === 'gap' && /^\d+(\.\d+)?px$/.test(value))
      return { gap: value, 'justify-content': 'flex-start' }
    if (property === 'justify-content' && ['start', 'flex-start'].includes(value)) {
      const gap = read(node, 'spacing').gap
      if (gap === 'normal' || /^\d+(\.\d+)?px$/.test(gap))
        return { gap: gap === 'normal' ? '0px' : gap, 'justify-content': 'flex-start' }
    }
  }

  function eligible(node, family) {
    return family === 'paint' ? !node.childElementCount && Boolean(node.textContent.trim()) : Boolean(separation(node))
  }

  function expectedPaint(node, requested) {
    const token = /^var\((--[\w-]+)\)$/.exec(requested)?.[1]
    return token ? ui.resolveColorVariable(node, token) : ui.normalizeSolidColor(requested)
  }

  function separation(node, includeColumn = false) {
    const style = getComputedStyle(node)
    const children = [...node.children].filter(visible)
    const column = includeColumn && style.flexDirection === 'column'
    if (!['flex', 'inline-flex'].includes(style.display) || (!column && style.flexDirection !== 'row') || style.flexWrap !== 'nowrap' ||
        style.direction !== 'ltr' || style.writingMode !== 'horizontal-tb' || children.length < 2) return null
    const bounds = children.map(child => child.getBoundingClientRect())
    return bounds.slice(1).map((rect, index) => column ? rect.top - bounds[index].bottom : rect.left - bounds[index].right)
  }

  function observation(use, values, count = 1) {
    const nodes = members(use)
    if (nodes.length < count) return null
    const evidence = { visibleMembers: nodes.length }
    for (const node of nodes) {
      if (binding(node).revision !== use.revision || !eligible(node, use.family)) return null
      const actual = read(node, use.family)
      if (use.family === 'paint') {
        if (actual.color !== expectedPaint(node, values.color)) return null
      } else {
        if (spacingProperties.some(property => actual[property] !== values[property])) return null
        const distances = separation(node)
        if (!distances || distances.some(distance => Math.abs(distance - parseFloat(values.gap)) > 1)) return null
        const range = evidence.spacingRange ?? []
        evidence.spacingRange = [Math.min(...range, ...distances), Math.max(...range, ...distances)]
      }
    }
    return { node: nodes[0], values: read(nodes[0], use.family), evidence }
  }

  function protectPeers(selected, use, nodes) {
    const region = selected.closest('main, [role=main]') ?? document.body
    const candidates = use.family === 'paint'
      ? [...region.querySelectorAll('p, h1, h2, h3, h4, h5, h6, span, small, label, td, th')].filter(node =>
        [...node.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim()))
      : [...new Set([...region.querySelectorAll('button, a')].map(node => node.parentElement))]
        .filter(node => [...node.children].filter(child => child.matches('button, a')).length >= 1 && node.children.length >= 2)
    const peers = candidates.filter(node => visible(node) && !nodes.some(member => member === node || member.contains(node)))
      .map(node => ({ node, before: read(node, use.family), distances: use.family === 'spacing' ? separation(node) : null }))
    return {
      count: peers.length,
      unchanged: () => peers.every(({ node, before, distances }) => {
        if (!visible(node)) return false
        const actual = read(node, use.family)
        const currentDistances = distances && separation(node)
        return Object.keys(before).every(key => actual[key] === before[key]) &&
          (!distances || (currentDistances?.length === distances.length &&
            currentDistances.every((distance, index) => Math.abs(distance - distances[index]) <= 1)))
      }),
    }
  }

  function observe(edit, hidden, latest) {
    if (edit.sourceState === 'conflict' || latest.sourceState === 'conflict') return { state: 'stale' }
    if (edit.sourceState !== 'verified') return { state: 'pending' }
    const use = latest.authoredBinding
    const nodes = members(use)
    if (!nodes.length) return { state: 'unobservable' }
    if (hidden) return { state: 'hidden', node: nodes[0] }
    if (nodes.some(node => binding(node).revision !== use.revision)) return { state: 'stale', node: nodes[0] }
    if (!observation(use, latest.authoredValues)) return { state: 'failed', node: nodes[0] }
    return { state: edit.id === latest.id ? 'applied' : 'superseded', node: nodes[0] }
  }

  async function compare(before) {
    if (window.parent === window) throw Error('Open this candidate in Canvas to compare source.')
    const requestId = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      const controller = new AbortController()
      const finish = reason => {
        clearTimeout(timer)
        controller.abort()
        if (reason) reject(Error(reason))
        else resolve()
      }
      const timer = setTimeout(() => finish('Canvas could not open the source comparison.'), 8500)
      window.addEventListener('message', event => {
        if (event.source !== window.parent || event.origin !== location.origin ||
            event.data?.type !== 'inspector-authored-compare-result' || event.data.requestId !== requestId) return
        finish(event.data.ok ? null : event.data.reason || 'Canvas could not open the source comparison.')
      }, { signal: controller.signal })
      window.parent.postMessage({ type: 'inspector-authored-compare', before, requestId }, location.origin)
    })
  }

  ui.authoredUsePreview = { attribute, binding, compare, eligible, expectedPaint, intent, members, samePreparedUse, observation, observe, protectPeers, read, separation }
})()
