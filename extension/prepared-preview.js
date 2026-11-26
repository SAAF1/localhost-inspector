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
  const choiceProperties = ['background-color','color','font-size','height','width']
  function choiceFields(node,input,option) {
    if (!input?.component) return []
    const live = ui.sourceComponentRequest(node,{type:'inspect'})
    if (live?.source !== input.component || live.properties.find(p=>p.id===input.field)?.value !== option) return []
    const tokens = input.verify?.[option]?.tokens ?? []
    return choiceProperties.filter(property => {
      const owner = declaration(node,property)
      return owner && tokens.some(token=>node.classList.contains(token) && owner.selector === '.'+CSS.escape(token))
    })
  }
  function choiceValues(node) {
    const css=getComputedStyle(node)
    return Object.fromEntries(choiceProperties.map(property=>[property,css.getPropertyValue(property)]))
  }
  function shows(node, input, option) {
    if (input?.component) return choiceFields(node,input,option).length > 0
    const check = input.verify?.[option]
    return check?.self ? node.matches(check.self) : Boolean(check?.child && node.querySelector(check.child))
  }
  function surfacePart(node, contract, property) {
    const surface = contract?.surface
    if (!surface?.ready[property]) return node
    const part = node.firstElementChild
    if (node.childElementCount !== 1 || !part || part.localName !== surface.tag ||
        part.getAttribute('data-li-surface') !== contract.revision ||
        getComputedStyle(part).getPropertyValue(surface.ready[property]).trim() !== '1') return
    const outer = node.getBoundingClientRect(), inner = part.getBoundingClientRect()
    const css = getComputedStyle(node)
    if (inner.width <= 0 || inner.height <= 0 ||
        ['top','left','bottom','right'].some(side => Math.abs(inner[side]-outer[side]) >
          (parseFloat(css.getPropertyValue('border-'+side+'-width')) || 0)+1)) return
    return part
  }
  function revisionOf(node) {
    return node?.getAttribute('data-li-revision') ?? node?.getAttribute('data-li-render-revision')
  }
  function revisionSelector(revision) {
    const value = CSS.escape(revision)
    return ':is([data-li-revision="' + value + '"],[data-li-render-revision="' + value + '"]:not([data-li-revision]))'
  }
  function membersOf(revision) {
    return document.querySelectorAll(revisionSelector(revision))
  }
  const renderedFields = ['background-color', 'border-radius', 'font-size']
  function declaration(part, property) {
    const css = getComputedStyle(part)
    const value = css.getPropertyValue('--li-owner-' + property).trim()
    if (!value.startsWith('"') || part.style.getPropertyValue(property)) return
    try {
      const [id,file,selector] = JSON.parse(decodeURIComponent(JSON.parse(value)))
      if (/^[a-f0-9]{32}$/.test(id) && typeof file === 'string' && typeof selector === 'string')
        return {id,file,selector}
    } catch { /* An unrelated app declaration is not a verified input. */ }
  }
  function sameBox(a, b) {
    const outer = a.getBoundingClientRect(), inner = b.getBoundingClientRect()
    return inner.width > 0 && inner.height > 0 &&
      ['left','right','top','bottom'].every(edge => Math.abs(outer[edge] - inner[edge]) <= 1)
  }
  function renderedPart(node, property) {
    let part = node, depth = 0
    if (property !== 'font-size') {
      // Follow a unique, coextensive painted surface. Never pick one sibling
      // among several, or follow a child merely because it has some paint.
      let child = node
      for (let level = 1; level <= 4; level++) {
        // Sibling controls and badges can share the container without owning
        // its surface. Only one direct child may occupy the envelope.
        const candidates = [...child.children].filter(n => sameBox(node,n))
        if (candidates.length > 1) return false
        if (!candidates.length || (level > 1 && child.childElementCount !== 1)) break
        child = candidates[0]
        const css = getComputedStyle(child)
        if (css.backgroundColor === 'rgba(0, 0, 0, 0)' && css.backgroundImage === 'none') continue
        if (!revisionOf(child) || css.backgroundImage !== 'none') return false
        if (level > 1 && node.childElementCount !== 1) return false
        part = child
        depth = level
      }
    }
    const css = getComputedStyle(part)
    if (property === 'background-color' && css.backgroundImage !== 'none') return false
    if (property === 'border-radius' && part !== node) {
      const envelope = getComputedStyle(node)
      if (envelope.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
          ['hidden','clip'].includes(envelope.overflowX) || ['hidden','clip'].includes(envelope.overflowY)) return false
    }
    const binding = declaration(part,property)
    if (part !== node && !binding) return false
    const revision = revisionOf(part)
    if (!binding || !/^[a-f0-9]{64}$/.test(revision ?? '')) return
    return { ...binding, depth, revision }
  }
  function samePart(a,b) {
    return a?.id === b?.id && a?.revision === b?.revision && a?.depth === b?.depth
  }
  function partNode(node,binding) {
    if (binding.depth === 1) {
      const matches = [...node.children].filter(child=>revisionOf(child)===binding.revision)
      return matches.length === 1 ? matches[0] : null
    }
    for (let i=0; node && i<binding.depth; i++) node = node.childElementCount===1 ? node.firstElementChild : null
    return revisionOf(node) === binding.revision ? node : null
  }
  function renderedTextMatches(node, requested) {
    const walker = document.createTreeWalker(node,NodeFilter.SHOW_TEXT)
    const range = document.createRange()
    let seen = false
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (!text.data.trim()) continue
      range.selectNodeContents(text)
      if (!range.getClientRects().length || getComputedStyle(text.parentElement).visibility !== 'visible') continue
      seen = true
      if (getComputedStyle(text.parentElement).fontSize !== requested) return false
    }
    return seen
  }
  function read(node, edit) {
    if (edit.prepared.part) {
      const part = partNode(node,edit.prepared.part)
      return part ? getComputedStyle(part).getPropertyValue(edit.property) : ''
    }
    return edit.prepared.field ? node.getAttribute('data-li-choice') :
      getComputedStyle(surfacePart(node, contract(node), edit.property) ?? node).getPropertyValue(edit.property)
  }
  function showsEffect(node, edit, prepared, observed = read(node, edit)) {
    const { property, requested, spacingToken, colorToken } = edit
    if (property === 'font-size' && edit.prepared.part) {
      const part = partNode(node,edit.prepared.part)
      if (!part || !renderedTextMatches(part,requested)) return false
    }
    if (edit.prepared.part && !samePart(prepared?.parts?.[property],edit.prepared.part)) return false
    if (prepared?.surface) {
      const part = surfacePart(node, prepared, property)
      if (!part || (prepared.surface.envelope.includes(property) &&
          getComputedStyle(node).getPropertyValue(property) !== observed)) return false
    }
    if (edit.prepared.effect) {
      const {property,value} = edit.prepared.effect
      if (!edit.prepared.field && property === 'gap') {
        const distances = ui.authoredUsePreview.separation(node, true)
        if (observed !== value || !distances || distances.some(distance => Math.abs(distance - parseFloat(value)) > 1))
          return false
      } else if (!choiceFields(node,prepared.input,requested).includes(property) ||
          getComputedStyle(node).getPropertyValue(property) !== value) return false
    }
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
    if (property === 'font-weight' && ['bold','normal'].includes(requested))
      return observed === (requested === 'bold' ? '700' : '400')
    if (['border-color','border-width'].includes(property) &&
        !['Top','Right','Bottom','Left'].some(side => parseFloat(getComputedStyle(node)['border'+side+'Width']) > 0))
      return false
    if (['color', 'background-color','border-color'].includes(property)) return observed === ui.normalizeSolidColor(requested)
    return observed === requested
  }
  let sheet
  let declarations = new Map()
  let inputs = new Map()
  function contract(node) {
    try {
      const c = JSON.parse(node.getAttribute('data-li-contract') ?? node.getAttribute('data-li-render-contract'))
      if (
        /^[a-z][a-z0-9-]{0,63}$/.test(c?.site) &&
        /^[a-f0-9]{64}$/.test(c.revision) &&
        revisions[c.site] === c.revision &&
        revisionOf(node) === c.revision
      ) {
        if (c.surface) c.styles = c.styles.filter(property => surfacePart(node,c,property))
        if (c.styleInputs) c.styles = c.styles.filter(property => {
          const input = c.styleInputs[property]
          return !input || (node.localName === input.tag && node.style.getPropertyValue(property) === input.expression)
        })
        if(c.cssReady){
          const computed=getComputedStyle(node)
          const available=key=>!c.cssReady[key] || (!c.logicalInline?.includes(key) || (computed.writingMode==='horizontal-tb' && computed.direction==='ltr')) && computed.getPropertyValue(c.cssReady[key]).trim()==='1'
          if(c.styles)c.styles=c.styles.filter(available)
          if(c.style && !available(c.style))delete c.style
        }
        if (c.renderedBindings && !c.surface) {
          c.parts = {}
          c.styles ??= []
          for (const field of renderedFields) {
            if (c.styleInputs?.[field]) continue
            const part = renderedPart(node,field)
            if (part === false || (getComputedStyle(node).getPropertyValue('--li-owner-' + field).trim() === 'unavailable' &&
                !part?.depth)) {
              c.styles = c.styles.filter(p => p !== field)
              continue
            }
            if (!part || (c.cssReady?.[field] && !part.depth)) continue
            c.parts[field] = part
            if (!c.styles.includes(field)) c.styles.push(field)
          }
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
        const part = edit.prepared.part
        if (part) {
          if (/^[a-f0-9]{32}$/.test(part.id) && /^[a-f0-9]{64}$/.test(part.revision) &&
              Number.isInteger(part.depth) && part.depth >= 0 && part.depth <= 4) {
            const owner = revisionSelector(revision)
            const child = revisionSelector(part.revision)
            const selector = part.depth === 1 ? owner + ':not(:has(> ' + child + ' ~ ' + child + ')) > ' + child :
              part.depth ? owner + ' > :only-child'.repeat(part.depth) + child : owner
            rules.push(selector + '{--li-render-' + part.id + ':' + edit.requested + '}')
          }
          continue
        }
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
    return document.querySelector(revisionSelector(edit.prepared.revision))
  }
  function observe(edit, visible, hidden) {
    if (!hidden && stale(edit)) return { state: 'stale' }
    const { revision, site, field } = edit.prepared
    const members = [...membersOf(revision)]
      .filter(visible)
    if (!members.length) return { state: hidden ? 'hidden' : 'unobservable' }
    const [node] = members
    if (hidden) return { state: 'hidden', node }
    if (edit.prepared.part && getComputedStyle(document.documentElement)
        .getPropertyValue('--li-known-' + edit.prepared.part.id).trim() !== '1') return {state:'stale',node}
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
    const revision = revisionOf(node)
    const edit = revision && declarations.get(revision + ':' + property)
    return edit?.property === property ? edit.requested : undefined
  }
  ui.preparedPreview = { choiceFields, choiceValues, membersOf, samePart, contract, project, locate, authored, shows, read, showsEffect, observe }
})()
