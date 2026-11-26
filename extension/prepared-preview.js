;(() => {
  const ui = window.LocalhostInspector
  let revisions = {}
  document.addEventListener('li-prepared-revisions', (event) => {
    try {
      revisions = JSON.parse(event.detail) ?? {}
    } catch {
      /* Unrecognized development runtime. */
    }
  })
  document.dispatchEvent(new Event('li-read-prepared-revisions'))
  function stale(edit) {
    return Object.hasOwn(revisions, edit.prepared.site) && revisions[edit.prepared.site] !== edit.prepared.revision
  }
  function shows(node, input, option) {
    const check = input.verify?.[option]
    return check?.self ? node.matches(check.self) : Boolean(check?.child && node.querySelector(check.child))
  }
  function read(node, edit) {
    return edit.prepared.field ? node.getAttribute('data-li-choice') :
      getComputedStyle(node).getPropertyValue(edit.property)
  }
  function showsEffect(node, edit, prepared, observed = read(node, edit)) {
    const { property, requested, spacingToken, colorToken } = edit
    if (edit.prepared.field)
      return prepared.input?.field === edit.prepared.field && observed === requested &&
        shows(node, prepared.input, requested)
    if (property === 'width' && ['100%', 'fit-content'].includes(requested)) {
      const parent = node.parentElement
      if (!parent || !ui.widthModes(node).length ||
          String(node.computedStyleMap().get('width')) !== requested ||
          !Number.isFinite(parseFloat(observed))) return false
      if (requested === 'fit-content') return true
      const style = getComputedStyle(parent)
      const available = parent.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      return Math.abs(parseFloat(observed) - available) <= 1
    }
    if (spacingToken) return ui.spacingVariableMatches(node, property, spacingToken.name, observed)
    if (colorToken) return observed === ui.resolveColorVariable(node, colorToken.name)
    if (['color', 'background-color'].includes(property)) return observed === ui.normalizeSolidColor(requested)
    return observed === requested
  }
  let sheet
  let declarations = new Map()
  let inputs = new Map()
  function contract(node) {
    try {
      const c = JSON.parse(node.getAttribute('data-li-contract'))
      if (
        /^[a-z][a-z0-9-]{0,63}$/.test(c?.site) &&
        /^[a-f0-9]{64}$/.test(c.revision) &&
        revisions[c.site] === c.revision &&
        node.getAttribute('data-li-revision') === c.revision
      ) {
        if(c.cssReady){
          const computed=getComputedStyle(node)
          const available=key=>!c.cssReady[key] || (!c.logicalInline?.includes(key) || (computed.writingMode==='horizontal-tb' && computed.direction==='ltr')) && computed.getPropertyValue(c.cssReady[key]).trim()==='1'
          if(c.styles)c.styles=c.styles.filter(available)
          if(c.style && !available(c.style))delete c.style
        }
        return c
      }
    } catch {
      /* Ordinary app node. */
    }
  }
  function send(revision, value) {
    document.dispatchEvent(new CustomEvent('li-prepared-input', { detail: JSON.stringify({ revision, value }) }))
  }
  document.addEventListener('li-prepared-ready', () => {
    for (const [revision, edit] of inputs) send(revision, edit.requested)
  })
  function supportedDeclaration(edit) {
    return !/[;{}]/.test(edit.requested) && CSS.supports(edit.property, edit.requested)
  }
  function project(records) {
    const next = new Map()
    const rules = []
    declarations = new Map()
    for (const edit of records) {
      if (!edit.prepared || edit.previewHidden) continue
      const { revision, field } = edit.prepared
      if (!/^[a-f0-9]{64}$/.test(revision)) continue
      if (field) next.set(revision, edit)
      else if (supportedDeclaration(edit)) {
        declarations.set(revision + ':' + edit.property, edit)
        if (['height', 'border-radius', 'background-color', 'font-size'].includes(edit.property)) {
          // Add a source-local default only while a value exists. A more specific
          // app rule in the same layer keeps its conditional ownership.
          for (const layer of ['ordinary', 'utilities']) {
            const selector = ':where([data-li-revision="' + revision + '"][data-li-local-' + layer + '~="' + edit.property + '"])'
            const rule = selector + '{' + edit.property + ':' + edit.requested + '}'
            rules.push(layer === 'ordinary' ? rule : '@layer utilities{' + rule + '}')
          }
        }
        if(edit.property.startsWith('padding-')){
          const prefix='--li-'+revision.slice(0,20)
          const shorthand=['top','right','bottom','left'].map(side=>'var('+prefix+'-padding-'+side+', var('+prefix+'-base-padding-'+side+'))').join(' ')
          rules.push('[data-li-revision="'+revision+'"]{'+prefix+'-padding:'+shorthand+'}')
        }
        rules.push(
          '[data-li-revision="' + revision + '"]{--li-' + revision.slice(0, 20) + ':' + edit.requested + ';--li-' + revision.slice(0, 20) + '-' + edit.property + ':' + edit.requested + '}',
        )
      }
    }
    if (sheet || rules.length) {
      if (!sheet) {
        sheet = new CSSStyleSheet()
        document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
      }
      const css = rules.join('\n')
      if (css !== sheet.lastProjection) {
        sheet.replaceSync(css)
        sheet.lastProjection = css
      }
    }
    for (const revision of inputs.keys()) if (!next.has(revision)) send(revision, null)
    for (const [revision, edit] of next) if (inputs.get(revision)?.requested !== edit.requested) send(revision, edit.requested)
    inputs = next
  }
  function locate(edit) {
    return document.querySelector('[data-li-revision="' + CSS.escape(edit.prepared.revision) + '"]')
  }
  function observe(edit, visible, hidden) {
    if (!hidden && stale(edit)) return { state: 'stale' }
    const { revision, site, field } = edit.prepared
    const members = [...document.querySelectorAll('[data-li-revision="' + CSS.escape(revision) + '"]')]
      .filter(visible)
    if (!members.length) return { state: hidden ? 'hidden' : 'unobservable' }
    const [node] = members
    if (hidden) return { state: 'hidden', node }
    const contracts = members.map(contract)
    if (contracts.some(c => !c || c.site !== site)) return { state: 'stale' }
    if (!field && !supportedDeclaration(edit)) return { state: 'failed', node }
    const current = field ? inputs.get(revision) : declarations.get(revision + ':' + edit.property)
    const effective = current && members.every((member, index) => {
      const c = contracts[index]
      return (field || c.style === edit.property || c.styles?.includes(edit.property)) &&
        showsEffect(member, current, c)
    })
    return { state: effective ? (current.id === edit.id ? 'applied' : 'superseded') : 'failed', node, visibleMembers: members.length }
  }
  function authored(node, property) {
    const revision = node.getAttribute('data-li-revision')
    const edit = revision && declarations.get(revision + ':' + property)
    return edit?.property === property ? edit.requested : undefined
  }
  ui.preparedPreview = { contract, project, locate, authored, shows, read, showsEffect, observe }
})()
