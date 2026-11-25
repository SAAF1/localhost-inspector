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
          const available=key=>(!c.logicalInline?.includes(key) || (computed.writingMode==='horizontal-tb' && computed.direction==='ltr')) && computed.getPropertyValue(c.cssReady[key]).trim()==='1'
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
    for (const [revision, value] of inputs) send(revision, value)
  })
  function project(records) {
    const next = new Map()
    const rules = []
    declarations = new Map()
    for (const edit of records) {
      if (!edit.prepared || edit.previewHidden) continue
      const { revision, field } = edit.prepared
      if (!/^[a-f0-9]{64}$/.test(revision)) continue
      if (field) next.set(revision, edit.requested)
      else if (!/[;{}]/.test(edit.requested) && CSS.supports(edit.property, edit.requested)) {
        declarations.set(revision + ':' + edit.property, edit)
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
    for (const [revision, value] of next) if (inputs.get(revision) !== value) send(revision, value)
    inputs = next
  }
  function locate(edit) {
    return document.querySelector('[data-li-revision="' + CSS.escape(edit.prepared.revision) + '"]')
  }
  function authored(node, property) {
    const revision = node.getAttribute('data-li-revision')
    const edit = revision && declarations.get(revision + ':' + property)
    return edit?.property === property ? edit.requested : undefined
  }
  ui.preparedPreview = { contract, project, locate, authored, stale, shows }
})()
