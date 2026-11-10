(() => {
  if (!window.phaseABridge) return
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:2147483647'
  const root = host.attachShadow({ mode: 'open' })
  root.innerHTML = `
    <style>
      :host { color-scheme: light }
      button,input,select { font:inherit }
      button,input,select { border:1px solid #d1d5db;border-radius:5px;background:#fff;color:#17202a;padding:5px 7px }
      button {cursor:pointer}
      button:disabled {cursor:default;opacity:.45}
      section {box-sizing:border-box;font:13px system-ui;background:#fff;color:#17202a;
        padding:12px;border:1px solid #d1d5db;width:244px;max-height:70vh;overflow:auto;
        position:fixed;bottom:48px;right:12px;box-shadow:0 6px 24px #0002;border-radius:8px}
      header, footer {display:flex;align-items:center;gap:6px}
      header {justify-content:space-between;min-height:27px}
      fieldset {border:0;border-top:1px solid #e5e7eb;margin:8px 0;padding:4px 0 0}
      legend {font-size:11px;font-weight:600;color:#465262;padding:0 5px 0 0}
      label {display:grid;grid-template-columns:1fr 110px;align-items:center;gap:8px;margin:4px 0}
      input,select {width:100%;min-width:0;box-sizing:border-box}
      output {display:block;margin-top:8px;color:#465262;font-size:11px}
      #outline {position:fixed;border:2px solid #1582ff;box-sizing:border-box;pointer-events:none}
      [hidden] {display:none!important}
    </style>
    <div id="outline" hidden></div>
    <button id="entry" aria-expanded="false">Inspector</button>
    <section hidden aria-label="Design inspector">
      <header><strong id="target">Command-click an element</strong><button id="parent" disabled>Parent</button></header>
      <div id="fields"></div>
      <footer><button id="undo">Undo</button><button id="clear">Before</button><button id="reset">Reset</button></footer>
      <output id="status" aria-live="polite"></output>
    </section>`
  document.documentElement.append(host)
  const get = (id) => root.getElementById(id)
  const panel = root.querySelector('section')
  const entries = new Map()
  const history = []
  let selected
  let busy = false
  let comparing = false
  let comparison = []
  let selectionObserver
  let activeRouteVersion = 0

  const normalize = (text) => text?.trim().replace(/\s+/g, ' ') ?? ''
  function describe(node) {
    return {
      tag: node.localName,
      id: node.id || null,
      slot: node.getAttribute('data-slot'),
      text: normalize(node.innerText).slice(0, 100),
    }
  }
  function candidates(target) {
    return Array.from(document.getElementsByTagName(target.tag)).filter(node =>
      node.isConnected && (target.id ? node.id === target.id : (
        node.getAttribute('data-slot') === target.slot &&
        Boolean(target.text) && normalize(node.innerText).slice(0, 100) === target.text
      ))
    )
  }
  const layouts = new Set(['flex','inline-flex','grid','inline-grid'])
  const flex = new Set(['flex','inline-flex'])
  const controls = [
    ['Layout', 'gap', 'Gap', 'pixels'],
    ['Layout', 'flex-direction', 'Direction', ['row','column','row-reverse','column-reverse']],
    ['Layout', 'justify-content', 'Distribution', ['normal','start','center','end','space-between','space-around','space-evenly','stretch']],
    ['Layout', 'align-items', 'Alignment', ['normal','start','center','end','stretch','baseline']],
    ['Layout', 'justify-items', 'Item alignment', ['normal','start','center','end','stretch']],
    ['Size', 'width', 'Width', 'size'],
    ['Size', 'height', 'Height', 'pixels'],
    ['Size', 'min-width', 'Min width', 'pixels'],
    ['Size', 'max-width', 'Max width', 'pixels'],
    ['Size', 'min-height', 'Min height', 'pixels'],
    ['Size', 'max-height', 'Max height', 'pixels'],
    ['Padding', 'padding', 'All sides', 'pixels'],
    ['Padding', 'padding-top', 'Top', 'pixels'],
    ['Padding', 'padding-right', 'Right', 'pixels'],
    ['Padding', 'padding-bottom', 'Bottom', 'pixels'],
    ['Padding', 'padding-left', 'Left', 'pixels'],
    ['Type', 'font-size', 'Font size', 'pixels'],
    ['Type', 'font-weight', 'Weight', ['100','200','300','400','500','600','700','800','900']],
    ['Type', 'line-height', 'Line height', 'pixels'],
    ['Type', 'letter-spacing', 'Letter spacing', 'pixels'],
    ['Type', 'text-align', 'Text alignment', ['start','center','end','left','right','justify']],
    ['Type', 'color', 'Text color', 'color'],
    ['Appearance', 'background-color', 'Fill', 'color'],
    ['Appearance', 'border-color', 'Border color', 'color'],
    ['Appearance', 'border-width', 'Border width', 'pixels'],
    ['Appearance', 'border-radius', 'Corner radius', 'pixels'],
  ]

  function widthModes(node) {
    const parent = node.parentElement && getComputedStyle(node.parentElement)
    const own = getComputedStyle(node)
    if (!parent || layouts.has(parent.display) || !['block','flow-root','flex','grid'].includes(own.display) ||
        own.boxSizing !== 'border-box' || !['static','relative'].includes(own.position)) return []
    return ['fill','hug']
  }
  function supported(property, node, style = getComputedStyle(node)) {
    if (property === 'gap' || property === 'justify-content' || property === 'align-items') return layouts.has(style.display)
    if (property === 'flex-direction') return flex.has(style.display)
    if (property === 'justify-items') return style.display.includes('grid')
    if (property === 'border-width' || property === 'border-color') return style.borderTopStyle !== 'none'
    return true
  }
  function syncOutline() {
    const outline = get('outline')
    outline.hidden = panel.hidden || !selected?.isConnected
    if (outline.hidden) return
    const box = selected.getBoundingClientRect()
    Object.assign(outline.style, { left: box.left + 'px', top: box.top + 'px', width: box.width + 'px', height: box.height + 'px' })
  }
  function overlayFor(node) {
    return node?.closest('[role=menu], [role=dialog], [role=alertdialog], [role=listbox], dialog[open], :popover-open')
  }
  function renderFields() {
    const fields = get('fields')
    fields.replaceChildren()
    get('parent').disabled = !selected?.parentElement
    if (!selected?.isConnected) return
    if (overlayFor(selected)) {
      const hint = document.createElement('p')
      hint.textContent = 'Editing inside an open overlay is unavailable.'
      fields.append(hint)
      return
    }
    const style = getComputedStyle(selected)
    const groups = new Map()
    for (const [group, property, label, kind] of controls) {
      if (!supported(property, selected, style)) continue
      if (!groups.has(group)) {
        const section = document.createElement('fieldset')
        const title = document.createElement('legend')
        title.textContent = group
        section.append(title)
        fields.append(section)
        groups.set(group, section)
      }
      const row = document.createElement('label')
      row.append(label)
      const input = document.createElement(Array.isArray(kind) ? 'select' : 'input')
      input.id = 'control-' + property
      input.disabled = comparing
      const value = style.getPropertyValue(property)
      if (Array.isArray(kind)) {
        for (const option of new Set([value, ...kind])) {
          const choice = document.createElement('option')
          choice.value = option
          choice.textContent = option
          input.append(choice)
        }
        input.value = value
      } else if (kind === 'color') {
        input.value = value
        input.placeholder = '#rrggbb'
      } else {
        input.type = 'number'
        input.step = 'any'
        input.min = property === 'letter-spacing' ? '-20' : '0'
        input.max = '2000'
        input.value = /^-?[\d.]+px$/.test(value) ? String(Number.parseFloat(value)) : ''
        input.placeholder = value
      }
      const node = selected
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); input.blur() }
      })
      input.onchange = () => run(async () => {
        if (selected !== node || !node.isConnected) return
        if (!input.checkValidity() || !input.value.trim()) throw Error('Enter a valid value')
        const requested = kind === 'color' || Array.isArray(kind) ? input.value.trim() : input.valueAsNumber + 'px'
        await commitEdit(node, property, requested)
      })
      row.append(input)
      groups.get(group).append(row)
      if (property === 'width' && widthModes(node).length) {
        const modes = document.createElement('label')
        modes.append('Width mode')
        const dropdown = document.createElement('select')
        dropdown.id = 'width-mode'
        dropdown.disabled = comparing
        for (const [key, title] of [['','Choose'],['fill','Fill'],['hug','Hug']]) {
          const option = document.createElement('option')
          option.value = key
          option.textContent = title
          dropdown.append(option)
        }
        dropdown.onchange = () => run(async () => {
          if (dropdown.value && selected === node) await commitEdit(node, property, dropdown.value === 'fill' ? '100%' : 'fit-content')
        })
        modes.append(dropdown)
        groups.get(group).append(modes)
      }
    }
  }
  function select(node) {
    selected = node
    selectionObserver?.disconnect()
    if (node) {
      selectionObserver = new ResizeObserver(syncOutline)
      selectionObserver.observe(node)
    }
    get('target').textContent = node ? node.localName + ' · ' + normalize(node.innerText).slice(0, 36) : 'Command-click an element'
    renderFields()
    syncOutline()
  }
  window.addEventListener('scroll', syncOutline, true)
  window.addEventListener('resize', syncOutline)
  function remove(entry) {
    const { node, property, prior, priorPriority, requested } = entry
    if (node.style.getPropertyValue(property) !== requested || node.style.getPropertyPriority(property) !== '') return
    if (prior) node.style.setProperty(property, prior, priorPriority)
    else node.style.removeProperty(property)
  }
  async function apply(node, property, requested) {
    if (!CSS.supports(property, requested)) throw Error('That value is not valid for this control')
    const baseline = getComputedStyle(node).getPropertyValue(property)
    const prior = node.style.getPropertyValue(property)
    const priorPriority = node.style.getPropertyPriority(property)
    if (property === 'padding' && [...node.style].some(key => /^padding-(top|right|bottom|left)$/.test(key))) {
      throw Error('Use individual sides when padding is already set inline')
    }
    const measure = () => {
      const box = node.getBoundingClientRect()
      return property === 'height' ? box.height : box.width
    }
    const beforeSize = measure()
    node.style.setProperty(property, requested)
    const declared = node.style.getPropertyValue(property)
    let observed = getComputedStyle(node).getPropertyValue(property)
    const mode = ['100%', 'fit-content'].includes(requested)
    const dimensions = property === 'width' || property === 'height'
    const changedSize = () => Math.abs(measure() - beforeSize) > 0.5
    const sameValue = () => observed === declared || observed === requested
    const verified = () => mode ? changedSize() : sameValue() && (!dimensions || changedSize() || baseline === observed)
    const deadline = performance.now() + 550
    while (node.isConnected && !verified() && performance.now() < deadline) {
      await new Promise(requestAnimationFrame)
      observed = getComputedStyle(node).getPropertyValue(property)
    }
    const entry = { node, property, input: requested, requested: declared, before: baseline, observed, prior, priorPriority }
    if (!node.isConnected || !verified()) {
      remove(entry)
      throw Error(dimensions ? 'The box did not resize as requested. Check its layout constraints.' : 'The browser kept a different value')
    }
    return entry
  }
  const route = () => location.pathname + location.search
  const status = (message) => { get('status').textContent = message }
  const send = (message) => window.phaseABridge(message)
  async function run(action) {
    if (busy) return
    busy = true
    try { await action() } catch (error) { status(error.message) }
    finally { busy = false; renderFields(); syncOutline() }
  }
  get('entry').onclick = () => { panel.hidden = !panel.hidden; get('entry').setAttribute('aria-expanded', String(!panel.hidden)); syncOutline() }
  get('parent').onclick = () => { if (selected?.parentElement) select(selected.parentElement) }
  function isSelectionGesture(event) {
    return !panel.hidden && event.metaKey && event.button === 0 && !event.composedPath().includes(host)
  }
  function preventPress(event) {
    if (!isSelectionGesture(event)) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  document.addEventListener('pointerdown', preventPress, true)
  document.addEventListener('mousedown', preventPress, true)
  document.addEventListener('click', event => {
    if (event.composedPath().includes(host) || panel.hidden) return
    if (!event.metaKey) { select(null); return }
    if (!isSelectionGesture(event)) return
    const node = event.composedPath().find(target => target instanceof HTMLElement)
    if (!node) return
    event.preventDefault()
    event.stopImmediatePropagation()
    select(node)
  }, true)
  async function commitEdit(node, property, requested) {
    if (comparing || !node.isConnected || overlayFor(node) || !supported(property, node)) return
    const editRoute = route()
    const version = activeRouteVersion
    const target = describe(node)
    const unique = candidates(target).length === 1
    status('Saving preview…')
    const entry = await apply(node, property, requested)
    const id = crypto.randomUUID()
    try {
      await send({ type: 'save', record: {
        id, route: editRoute, target, property, before: entry.before,
        requested, observed: entry.observed, restore: unique ? 'unique' : 'ambiguous',
        viewport: { width: innerWidth, height: innerHeight },
      } })
    } catch (error) {
      remove(entry)
      throw error
    }
    if (activeRouteVersion === version && node.isConnected) {
      entries.set(id, entry)
      history.push(id)
    } else remove(entry)
    status(unique ? 'Preview saved' : 'Preview saved · target ambiguous on reload')
  }
  get('undo').onclick = () => run(async () => {
    const id = history.at(-1)
    if (!id || comparing) return
    const entry = entries.get(id)
    status('Undoing…')
    await send({ type: 'undo', id })
    remove(entry)
    entries.delete(id)
    const index = history.lastIndexOf(id)
    if (index >= 0) history.splice(index, 1)
    status('Undone')
  })
  function clearVisible() {
    for (const entry of Array.from(entries.values()).reverse()) remove(entry)
    entries.clear()
    history.length = 0
  }
  get('clear').onclick = () => run(async () => {
    comparing = !comparing
    get('clear').textContent = comparing ? 'After' : 'Before'
    if (comparing) {
      comparison = Array.from(entries, ([id, entry]) => ({ id, entry, target: describe(entry.node) }))
      clearVisible()
    } else {
      for (const { id, entry, target } of comparison) {
        const { node, property, before, input } = entry
        if (!node.isConnected || JSON.stringify(describe(node)) !== JSON.stringify(target) ||
            getComputedStyle(node).getPropertyValue(property) !== before) continue
        entries.set(id, await apply(node, property, input))
        history.push(id)
      }
      comparison = []
      await restore(route(), activeRouteVersion)
    }
    status(comparing ? 'Original view' : 'Previews on')
  })
  get('reset').onclick = () => run(async () => {
    await send({ type: 'reset', route: route() })
    comparison = []
    clearVisible()
    status('Previews reset on this page')
  })
  async function restore(requestedRoute, version) {
    const journal = await send({ type: 'load' })
    for (const edit of journal.filter(e => !e.undone && e.route === requestedRoute)) {
      if (version !== activeRouteVersion || comparing || route() !== requestedRoute) return
      if (edit.restore !== 'unique' || entries.has(edit.id)) continue
      let matches = candidates(edit.target)
      const deadline = performance.now() + 1800
      while (route() === requestedRoute && matches.length === 0 && performance.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 40))
        matches = candidates(edit.target)
      }
      if (version !== activeRouteVersion || comparing || route() !== requestedRoute) return
      if (matches.length !== 1) continue
      if (getComputedStyle(matches[0]).getPropertyValue(edit.property) !== edit.before) continue
      const entry = await apply(matches[0], edit.property, edit.requested)
      if (version !== activeRouteVersion || comparing || route() !== requestedRoute || !entry.node.isConnected) { remove(entry); return }
      entries.set(edit.id, entry)
      history.push(edit.id)
    }
  }
  let currentRoute = route()
  let generation = 0
  function loadRoute() {
    const requestedRoute = currentRoute
    const version = ++generation
    status('Loading previews…')
    const epoch = ++activeRouteVersion
    return (comparing ? Promise.resolve() : restore(requestedRoute, epoch)).then(() => {
      if (generation === version) status('Ready')
    }).catch(error => {
      if (generation === version) status(error.message)
    })
  }
  function onRouteChange() {
    if (selected && !selected.isConnected) select(null)
    if (currentRoute === route()) return
    currentRoute = route()
    comparison = []
    clearVisible()
    select(null)
    window.phaseAInspectorReady = loadRoute()
  }
  new MutationObserver(onRouteChange).observe(document.documentElement, { childList: true, subtree: true })
  window.addEventListener('popstate', onRouteChange)
  window.phaseAInspectorReady = loadRoute()
})()
