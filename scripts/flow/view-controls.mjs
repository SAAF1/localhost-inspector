const checkPath = 'm2 5.5 3 3L10 3'

export function connectViewControls({ apply, read, presets }) {
  const toolbar = document.querySelector('#workspace-toolbar')
  const dock = document.querySelector('#localhost-inspector-dock')
  const inspector = toolbar.querySelector('#inspector-toggle')
  const trigger = toolbar.querySelector('#frame-view-toggle')
  const menu = toolbar.querySelector('#frame-view-menu')

  function syncInspector() {
    inspector.hidden = !dock.firstElementChild
    inspector.disabled = dock.inert
    const open = dock.hasAttribute('data-inspector-open')
    inspector.setAttribute('aria-expanded', String(open))
    const floating = dock.hasAttribute('data-inspector-floating') && document.body.hasAttribute('data-expanded')
    inspector.title = floating ? 'Dock Inspector' : open ? 'Collapse Inspector' : 'Open Inspector'
    inspector.setAttribute('aria-label', inspector.title)
    if (open) document.documentElement.style.setProperty('--li-workspace-panel-width', dock.offsetWidth + 'px')
  }
  const inspectorObserver = new MutationObserver(syncInspector)
  inspectorObserver.observe(dock, { childList: true, attributes: true })
  inspectorObserver.observe(document.body, { attributes: true, attributeFilter: ['data-expanded'] })
  syncInspector()
  inspector.addEventListener('click', () => dock.firstElementChild?.dispatchEvent(new Event('toggle-workspace-inspector')))

  function close(focus = false) {
    menu.hidden = true
    trigger.setAttribute('aria-expanded', 'false')
    if (focus && !trigger.hidden) trigger.focus()
  }

  function group(label, choices, current, onChoose) {
    const section = document.createElement('div')
    section.setAttribute('role', 'group')
    section.setAttribute('aria-label', label)
    for (const [key, name, detail, disabled] of choices) {
      const row = document.createElement('button')
      row.type = 'button'
      row.disabled = Boolean(disabled)
      row.setAttribute('role', 'menuitemradio')
      row.setAttribute('aria-checked', String(current === key))
      row.tabIndex = -1
      const check = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
      check.classList.add('frame-view-check')
      check.setAttribute('viewBox', '0 0 12 12')
      check.setAttribute('aria-hidden', 'true')
      const path = document.createElementNS(check.namespaceURI, 'path')
      path.setAttribute('d', checkPath)
      path.setAttribute('fill', 'none')
      path.setAttribute('stroke', 'currentColor')
      check.append(path)
      const text = document.createElement('span')
      text.textContent = name
      row.append(check, text)
      if (detail) {
        const dimensions = document.createElement('span')
        dimensions.className = 'frame-view-dimensions'
        dimensions.textContent = detail
        row.append(dimensions)
      }
      row.addEventListener('click', () => { close(true); void onChoose(key) })
      section.append(row)
    }
    return section
  }

  function open(last = false) {
    const state = read()
    if (!state || trigger.getAttribute('aria-disabled') === 'true') return
    const separator = document.createElement('div')
    separator.className = 'frame-view-divider'
    separator.setAttribute('role', 'separator')
    menu.replaceChildren(
      group('Frame size', Object.entries(presets).map(([key, size]) =>
        [key, size.label, size.width + ' × ' + size.height]), state.preset, preset => apply({ preset })),
      separator,
      group('Frame height', [
        ['fixed', 'Fixed height', null, !state.mode],
        ['hug', 'Hug page contents', null, !state.canHug],
      ], state.mode, mode => apply({ mode })),
    )
    menu.hidden = false
    trigger.setAttribute('aria-expanded', 'true')
    const enabled = [...menu.querySelectorAll('button:enabled')]
    const checked = enabled.find(row => row.getAttribute('aria-checked') === 'true')
    const target = last ? enabled.at(-1) : checked ?? enabled[0]
    target?.focus()
  }
  trigger.addEventListener('click', () => { if (menu.hidden) open(); else close(true) })
  trigger.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return
    event.preventDefault()
    open(event.key === 'ArrowUp')
  })
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
    } else if (event.key === 'Tab') {
      close(true)
    } else if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const rows = [...menu.querySelectorAll('button:enabled')]
      const index = rows.indexOf(document.activeElement)
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 :
        (index + (event.key === 'ArrowUp' ? -1 : 1) + rows.length) % rows.length
      rows[next]?.focus()
    }
  })
  document.addEventListener('pointerdown', event => {
    if (!menu.hidden && !menu.contains(event.target) && !trigger.contains(event.target)) close()
  }, true)
  return function sync(show, busy) {
    trigger.hidden = !show
    trigger.setAttribute('aria-disabled', String(busy))
    if (!show || busy) close()
  }
}
