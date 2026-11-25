(() => {
  const ui = window.LocalhostInspector
  const keyAttribute = 'data-inspector-target'
  // A repeated marker names one authored template part. Occurrence keys still identify individual records.
  const templateAttribute = 'data-inspector-template'
  const contextAttribute = name => /^data-(?!inspector-|localhost-inspector-|li-authored-use$|state$|slot$|theme$|active$|disabled$|open$|selected$|highlighted$|hovered$)/.test(name)
  const templateOf = node => {
    const value = node?.getAttribute(templateAttribute)
    return /^[a-z0-9][a-z0-9._:/-]{0,119}$/i.test(value ?? '') ? value : undefined
  }
  const normalize = text => (text ?? '').trim().replace(/\s+/g, ' ')
  const labelOf = node => normalize(node.innerText || node.getAttribute('aria-label')).slice(0, 100)
  const landmarks = {
    main: 'main, [role="main"]',
    navigation: 'nav, [role="navigation"]',
    complementary: 'aside, [role="complementary"]',
  }

  function targetKey(node) {
    const key = node.getAttribute(keyAttribute)
    return key?.trim() && key.length <= 120 ? key : null
  }

  async function fingerprint(text) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
  }

  const templateSources = new Map()
  function sourceFingerprint(source) {
    if (!templateSources.has(source)) {
      const cached = {}
      cached.ready = fingerprint(source).then(value => { cached.value = value; return value })
      templateSources.set(source, cached)
    }
    return templateSources.get(source)
  }
  ui.templateSourceFingerprint = source => typeof source === 'string'
    ? sourceFingerprint(source).ready.then(value => 'v2:' + value) : undefined

  function explicitRole(node) {
    const role = node.getAttribute('role')?.trim().split(/\s+/, 1)[0]
    return role && role.length <= 20 ? role : undefined
  }

  const repeated = 'tr, li, article, [role="row"], [role="listitem"], [role="option"], [role="article"]'
  const headings = 'h1, h2, h3, h4, h5, h6'

  function sectionName(section) {
    if (!section) return ''
    const label = normalize(section.getAttribute('aria-label'))
    if (label) return label
    const owned = Array.from(section.querySelectorAll(headings)).filter(heading =>
      heading.closest('section') === section && !heading.closest(repeated))
    const level = Math.min(...owned.map(heading => Number(heading.localName[1])))
    const titles = owned.filter(heading => Number(heading.localName[1]) === level)
    return titles.length === 1 ? normalize(titles[0].textContent) : ''
  }

  function scopedAnchor(node, text, useSection = true) {
    // A repeated item needs its own authored identifier, even on a page
    // that currently has just one item.
    if (!text) return null
    const semantic = node.matches('h1, h2, h3, h4, h5, h6, p, button, a, label, [role], [aria-label]')
    if (!semantic && node.childElementCount) return null
    const path = []
    let sectionAnchor
    for (let child = node; child.parentElement && path.length < 8; child = child.parentElement) {
      if (child.matches(repeated) || !/^[a-z][a-z0-9-]{0,39}$/.test(child.localName)) return null
      path.unshift(child.localName)
      const parent = child.parentElement
      const key = targetKey(parent)
      if (key) return { kind: 'key', value: key, path: path.join('>') }
      if (semantic && parent.id && parent.id.length <= 120) return sectionAnchor ?? { kind: 'id', value: parent.id, path: path.join('>') }
      if (useSection && parent.localName === 'section' && parent === node.closest('section') &&
          node.matches(headings + ', p') && !node.closest(repeated)) {
        const name = sectionName(parent)
        if (name && name !== normalize(node.textContent)) {
          sectionAnchor = { kind: 'section', value: 'section', path: path.join('>') }
        }
      }
      if (semantic) {
        const landmark = Object.keys(landmarks).find(name => parent.matches(landmarks[name]))
        if (landmark) return sectionAnchor ?? { kind: landmark === 'main' ? 'main' : 'landmark', value: landmark, path: path.join('>') }
      }
    }
    return sectionAnchor ?? null
  }

  const sameAnchor = (a, b) => Boolean(a && b && a.kind === b.kind && a.value === b.value && a.path === b.path)

  function regionIdentity(node, anchor) {
    const regions = []
    if (anchor?.kind === 'section') {
      regions.push({ section: sectionName(node.closest('section')), text: normalize(node.textContent) })
    }
    let parent = node.parentElement
    for (let depth = 0; parent && depth < 6; depth++, parent = parent.parentElement) {
      const key = targetKey(parent)
      const id = !key && parent.id && parent.id.length <= 120 ? parent.id : undefined
      const role = explicitRole(parent)
      if (key || id || role) regions.push({ tag: parent.localName, key: key ?? undefined, id, role })
    }
    return JSON.stringify(regions)
  }

  function classIdentity(node) {
    return JSON.stringify(Array.from(node.classList).sort())
  }

  function dataContext(node, legacySelectedDepth = -1) {
    const evidence = []
    for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
      const attrs = Array.from(node.attributes)
        .filter(attr => contextAttribute(attr.name))
        .map(attr => [attr.name, attr.value])
      if (depth === legacySelectedDepth) attrs.push(['data-localhost-inspector-selected', ''])
      attrs.sort(([left], [right]) => left.localeCompare(right))
      if (attrs.length) evidence.push([depth, attrs])
    }
    return JSON.stringify(evidence)
  }

  function describe(node, useSection = true) {
    const key = targetKey(node)
    const id = node.id || null
    const text = labelOf(node)
    const anchor = !key && !id ? scopedAnchor(node, text, useSection) : null
    const guarded = !key && (id || anchor)
    return {
      tag: node.localName, id, key, slot: node.getAttribute('data-slot'), text,
      ...(anchor ? { anchor } : {}),
      region: guarded ? regionIdentity(node, anchor) : undefined,
      classes: guarded ? classIdentity(node) : undefined,
      context: guarded ? dataContext(node) : undefined,
    }
  }

  function matchesTarget(node, target, rebind = false) {
    if (target?.mount) return node?.isConnected && ui.componentEdits.liveNode(target) === node
    if (!node?.isConnected || !target || node.localName !== target.tag ||
        node.getAttribute('data-slot') !== target.slot) return false
    const key = targetKey(node)
    if (target.key || key) return key === target.key
    if ((node.id || null) !== target.id || (target.region !== undefined && target.region !== regionIdentity(node, target.anchor))) return false
    if (target.anchor && !sameAnchor(target.anchor, scopedAnchor(node, labelOf(node), target.anchor.kind === 'section'))) return false
    if (target.classes !== undefined && target.classes !== classIdentity(node)) return false
    if (target.context !== undefined && target.context !== dataContext(node)) return false
    // A live ID-bearing node can outlast changes to its descendants. A new
    // node found through a legacy ID still needs the recorded text guard.
    return (!rebind && Boolean(target.id)) || !target.text ||
      labelOf(node) === target.text
  }

  function candidatesFor(target, exemplar) {
    if (target.anchor && !target.key && !target.id) {
      const { kind, value, path } = target.anchor
      if (!/^[a-z][a-z0-9-]{0,39}(>[a-z][a-z0-9-]{0,39}){0,7}$/.test(path)) return []
      if (kind === 'section') {
        const eligible = new Map()
        const wanted = exemplar && sectionName(exemplar.closest('section'))
        for (const root of document.querySelectorAll('section')) {
          const name = sectionName(root)
          if (name && (!exemplar || name === wanted)) eligible.set(name, eligible.has(name) ? null : root)
        }
        return Array.from(eligible.values()).flatMap(root => root
          ? Array.from(root.querySelectorAll(':scope>' + path)).filter(node =>
            node.closest('section') === root && node.getAttribute('data-slot') === target.slot)
          : [])
      }
      const selector = kind === 'main' || kind === 'landmark' ? (Object.hasOwn(landmarks, value) && landmarks[value]) :
        kind === 'key' ? '[' + keyAttribute + '="' + CSS.escape(value) + '"]' : '#' + CSS.escape(value)
      if (!selector) return []
      const roots = document.querySelectorAll(selector)
      if (roots.length !== 1) return []
      return [...roots[0].querySelectorAll(':scope>' + path)]
        .filter(node => node.getAttribute('data-slot') === target.slot)
    }
    if (!target.key && !target.id) return []
    const selector = target.key
      ? '[' + keyAttribute + '="' + CSS.escape(target.key) + '"]'
      : '#' + CSS.escape(target.id)
    return Array.from(document.querySelectorAll(selector))
  }

  function findTarget(target, liveNode) {
    const candidates = candidatesFor(target, liveNode)
    const label = target.anchor && (target.text || (liveNode && labelOf(liveNode)))
    const matches = label ? candidates.filter(node => labelOf(node) === label) : candidates
    if (matches.length !== 1) return null
    const [node] = matches
    return matchesTarget(node, target, node !== liveNode) ? node : null
  }

  function ownsDeclaration({ node, property, requested }) {
    return node.style.getPropertyValue(property) === requested &&
      node.style.getPropertyPriority(property) === ''
  }

  async function verifySavedNode(edit, node, identity, isCurrent) {
    const { key, anchor, textFingerprint, regionFingerprint, classFingerprint, contextFingerprint } = edit.target
    if (anchor && (!textFingerprint || !regionFingerprint || !classFingerprint)) return false
    if (!key && (textFingerprint || regionFingerprint || classFingerprint)) {
      const [text, region, classes] = await Promise.all([
        textFingerprint && fingerprint(identity.text),
        regionFingerprint && fingerprint(identity.region ?? ''),
        classFingerprint && fingerprint(identity.classes ?? ''),
      ])
      if (text !== textFingerprint || region !== regionFingerprint || classes !== classFingerprint) return false
    }
    if (contextFingerprint && await fingerprint(identity.context ?? '') !== contextFingerprint) {
      // Earlier variant journals included the Inspector's own selection marker
      // on the target or one of its ancestors. Require the exact old fingerprint.
      if (!window.localhostInspectorDock?.matches('#variant-dock')) return false
      const legacy = await Promise.all(Array.from({ length: 6 }, (_, depth) => fingerprint(dataContext(node, depth))))
      if (!legacy.includes(contextFingerprint)) return false
    }
    return isCurrent() && findTarget(edit.target, node) === node && matchesTarget(node, identity, true)
  }

  async function resolveSavedNode(edit, isCurrent) {
    const { target } = edit
    if (target.anchor?.kind === 'section') {
      const candidates = candidatesFor(target)
      const matches = await Promise.all(candidates.map(node =>
        verifySavedNode(edit, node, describe(node), isCurrent)))
      return matches.filter(Boolean).length === 1 ? candidates[matches.indexOf(true)] : null
    }
    let node = findTarget(target)
    if (!node && target.anchor && target.textFingerprint) {
      const labels = new Set(candidatesFor(target).map(labelOf))
      const checks = await Promise.all(Array.from(labels, async label => [label, await fingerprint(label)]))
      const match = checks.find(([, digest]) => digest === target.textFingerprint)
      if (match) node = findTarget({ ...target, text: match[0] })
    }
    return node && await verifySavedNode(edit, node, describe(node, false), isCurrent) ? node : null
  }

  ui.describeSourceContext = node => {
    const ancestors = []
    for (let parent = node.parentElement; parent && ancestors.length < 6; parent = parent.parentElement) {
      const role = explicitRole(parent)
      ancestors.push({
        tag: parent.localName,
        slot: parent.getAttribute('data-slot'),
        ...(role ? { role } : {}),
      })
    }
    const childTags = []
    for (let child = node.firstElementChild; child && childTags.length < 4; child = child.nextElementSibling) {
      childTags.push(child.localName)
    }
    const box = node.getBoundingClientRect()
    const bounds = [box.x, box.y, box.width, box.height].map(Math.round)
    const context = { ancestors, childTags, bounds }
    const cell = node.closest('td,th')
    const row = cell?.parentElement
    if (row?.localName !== 'tr' || cell.cellIndex < 0) return context
    return {
      ...context,
      tableCellPosition: cell.cellIndex + 1,
      tableRowCellCount: row.cells.length,
    }
  }

  ui.describePreviewTarget = describe
  ui.previewTargetForJournal = async ({ text, region, classes, context, ...target }) => ({
    ...target,
    ...(!target.key && (target.id || target.anchor) && text ? { textFingerprint: await fingerprint(text) } : {}),
    ...(region !== undefined ? { regionFingerprint: await fingerprint(region) } : {}),
    ...(classes !== undefined ? { classFingerprint: await fingerprint(classes) } : {}),
    ...(context !== undefined ? { contextFingerprint: await fingerprint(context) } : {}),
  })
  ui.findPreviewTarget = findTarget
  ui.matchesPreviewTarget = matchesTarget
  ui.ownsPreviewDeclaration = ownsDeclaration
  ui.isPreviewContextAttribute = contextAttribute
  const templateMatches = (edit, node) => node.isConnected && templateOf(node) === edit.template &&
    node.localName === edit.target.tag && node.getAttribute('data-slot') === edit.target.slot
  const templateNodes = edit => Array.from(document.querySelectorAll(
    '[' + templateAttribute + '="' + CSS.escape(edit.template) + '"]',
  )).filter(node => node instanceof HTMLElement && templateMatches(edit, node) &&
    node.getClientRects().length && getComputedStyle(node).visibility === 'visible')
  ui.templatePreview = { attribute: templateAttribute, of: templateOf, nodes: templateNodes }
  ui.createPreviewRecovery = ({ apply, remove, canEdit, removeButtonSize, readFrameState, projectTextStyles }) => {
    const saved = new Map()
    const attached = new Map()
    const inlineStacks = new WeakMap()
    const entryIds = new WeakMap()
    const lastResolved = new WeakMap()
    const templateIndex = new Map()
    const conflicts = new Set()
    let templateConflicts = new WeakMap()
    const original = new Map()
    let savedRoute
    const inState = (edit, state) => !edit?.frameState || edit.frameState === state
    const hasScopedEdits = () => Array.from(saved.values()).some(edit => edit.frameState)
    const currentState = () => hasScopedEdits() ? readFrameState() : undefined
    const editId = (id, entry) => entry.templateEditId ?? id
    const templateLayers = id => Array.from(templateIndex.get(id)?.values() ?? [])
    const conflicted = (edit, node) => templateConflicts.get(node)?.has(edit.property)

    function templateSource(node, property, pendingLayer, positional = false) {
      return ui.authoredTemplateSource(node, property, current => {
        const layers = inlineStacks.get(current)?.get(property)
        const pending = pendingLayer?.node === current ? pendingLayer : undefined
        const first = layers?.[0] ?? pending
        if (first && ownsDeclaration(pending ?? layers.at(-1))) return { value: first.prior, priority: first.priorPriority }
      }, positional)
    }

    function savedTemplateSource(edit, node, pendingLayer) {
      const positional = Boolean(edit.templateSourceFingerprint && !edit.templateSourceFingerprint.startsWith('v2:'))
      return templateSource(node, edit.property, pendingLayer, positional)
    }

    function sameTemplateSource(edit, node, pendingLayer) {
      const source = savedTemplateSource(edit, node, pendingLayer)
      if (source === null || (source === undefined) !== (edit.templateSourceFingerprint === undefined)) return false
      if (source === undefined) return true
      const { value } = sourceFingerprint(source)
      return value === undefined ? undefined : value === edit.templateSourceFingerprint?.replace(/^v2:/, '')
    }

    const sessionEntry = entry => entry?.property === 'button-size' || Boolean(entry?.target?.mount)

    function attach(id, entry) {
      attached.set(id, entry)
      const record = saved.get(editId(id, entry))
      entryIds.set(entry, editId(id, entry))
      if (record && !record.template && !record.target.mount)
        lastResolved.set(record, { node: entry.node, identity: entry.liveTarget })
      if (!inlineStacks.has(entry.node)) inlineStacks.set(entry.node, new Map())
      const stacks = inlineStacks.get(entry.node)
      if (!stacks.has(entry.property)) stacks.set(entry.property, [])
      stacks.get(entry.property).push(entry)
    }

    function attachTemplate(edit, entry) {
      entry.templateEditId = edit.id
      const key = Symbol()
      attach(key, entry)
      if (!templateIndex.has(edit.id)) templateIndex.set(edit.id, new Map())
      templateIndex.get(edit.id).set(entry.node, [key, entry])
    }

    function detach(id, preserveDeclaration = false) {
      const entry = attached.get(id)
      if (!entry) return
      if (!sessionEntry(entry) && !preserveDeclaration) remove(entry)
      attached.delete(id)
      const stack = inlineStacks.get(entry.node).get(entry.property)
      stack.splice(stack.indexOf(entry), 1)
      if (entry.templateEditId) {
        const nodes = templateIndex.get(entry.templateEditId)
        nodes.delete(entry.node)
        if (!nodes.size) templateIndex.delete(entry.templateEditId)
      }
    }

    function topEntries() {
      const byNode = new Map()
      for (const entry of attached.values()) {
        if (sessionEntry(entry)) continue
        if (!byNode.has(entry.node)) byNode.set(entry.node, new Map())
        byNode.get(entry.node).set(entry.property, entry)
      }
      return Array.from(byNode.values()).flatMap(properties => Array.from(properties.values()))
    }

    function lostPreview(entry) {
      if (!ownsDeclaration(entry)) return true
      // Responsive width modes can change their computed size with layout.
      if (!entry.node.isConnected || ['100%', 'fit-content'].includes(entry.requested)) return false
      if (entry.spacingToken) return !ui.spacingVariableMatches(entry.node, entry.property, entry.spacingToken.name)
      if (entry.textStyleToken || entry.pendingTextStyle) return !ui.textStyleMatches(
        getComputedStyle(entry.node).getPropertyValue(entry.property),
        entry.pendingTextStyle?.values[entry.property] ?? ui.textStyleValues(entry.node, entry.textStyleToken.name)?.[entry.property],
      )
      const expected = entry.colorToken ? ui.resolveColorVariable(entry.node, entry.colorToken.name) : entry.observed
      return getComputedStyle(entry.node).getPropertyValue(entry.property) !== expected
    }

    function hasStyleConflict(records) {
      return topEntries().some(entry => (!records ||
        records.some(record => record.target.contains(entry.node))) && lostPreview(entry))
    }

    function reconcileConflicts(entries = topEntries()) {
      const lost = entries.filter(entry => !sessionEntry(entry) && lostPreview(entry))
      if (!lost.length) return
      const suppressed = new Map()
      const appOwned = new Map()
      const mark = (index, node, property, from) => {
        if (!index.has(node)) index.set(node, new Map())
        const properties = index.get(node)
        properties.set(property, Math.min(properties.get(property) ?? Infinity, from))
      }
      for (const entry of lost) {
        mark(suppressed, entry.node, entry.property, 0)
        // When the app took ownership, even a value equal to an earlier
        // preview layer belongs to the app now.
        if (!ownsDeclaration(entry)) mark(appOwned, entry.node, entry.property, 0)
      }
      const pairs = new Map()
      for (const edits of operations().values()) {
        if (edits[0].template && edits.length === 2) {
          pairs.set(edits[0].id, edits[1].id)
          pairs.set(edits[1].id, edits[0].id)
        }
      }
      const layers = Array.from(attached)
      const positions = new Map(layers.map(([id], index) => [id, index]))
      for (const [, layer] of layers) {
        if (suppressed.get(layer.node)?.get(layer.property) !== 0) continue
        const pair = templateIndex.get(pairs.get(layer.templateEditId))?.get(layer.node)
        if (pair) mark(suppressed, layer.node, pair[1].property, positions.get(pair[0]))
      }
      // Unwind newer layers before removing the other side of a broken pair.
      for (let index = layers.length - 1; index >= 0; index--) {
        const [id, layer] = layers[index]
        if (index < (suppressed.get(layer.node)?.get(layer.property) ?? Infinity)) continue
        detach(id, appOwned.get(layer.node)?.has(layer.property))
        if (layer.templateEditId) {
          if (!templateConflicts.has(layer.node)) templateConflicts.set(layer.node, new Set())
          templateConflicts.get(layer.node).add(layer.property)
        } else conflicts.add(id)
      }
    }

    function clearAttached() {
      for (const id of Array.from(attached.keys()).reverse()) detach(id)
    }

    function projectPrepared(extra) {
      const records = Array.from(saved.values()).filter(edit => edit.prepared)
      if (extra) records.push(...(Array.isArray(extra)?extra:[extra]))
      ui.preparedPreview.project(records)
    }
    function clear() {
      ui.preparedPreview.project([])
      reconcileConflicts()
      clearAttached()
      saved.clear()
      conflicts.clear()
      templateConflicts = new WeakMap()
      original.clear()
    }

    function load(edits, route) {
      savedRoute = route
      saved.clear()
      for (const edit of edits) saved.set(edit.id, edit)
      for (const id of original.keys()) if (!saved.has(id)) original.delete(id)
      for (const id of conflicts) {
        if (!saved.has(id)) conflicts.delete(id)
      }
    }

    function isAttached(edit, entry) {
      if (edit?.template) return templateMatches(edit, entry.node) && sameTemplateSource(edit, entry.node) === true
      return Boolean(edit && matchesTarget(entry.node, entry.liveTarget) &&
        (edit.restore !== 'unique' || findTarget(edit.target, entry.node) === entry.node))
    }

    function forget(id) {
      reconcileConflicts()
      const group = saved.get(id)?.group
      const ids = group ? Array.from(saved.values()).filter(edit => edit.group === group).map(edit => edit.id) : [id]
      const hadPrepared = ids.some(id => saved.get(id)?.prepared)
      const removed = new Set(ids)
      for (const [key, entry] of Array.from(attached).reverse()) {
        if (removed.has(editId(key, entry))) detach(key)
      }
      for (const member of ids) {
        saved.delete(member)
        original.delete(member)
        conflicts.delete(member)
      }
      if (hadPrepared) projectPrepared()
    }

    function operations() {
      const groups = new Map()
      for (const edit of saved.values()) {
        const id = edit.group ?? edit.id
        if (!groups.has(id)) groups.set(id, [])
        groups.get(id).push(edit)
      }
      return groups
    }

    function sharedGroupValid(edits) {
      return !edits[0].sharedPadding ||
        (!edits.some(edit => conflicts.has(edit.id)) && ui.sharedPadding.matchesGroup(edits))
    }

    function prune(groups, state) {
      reconcileConflicts()
      const invalid = new Set()
      for (const [id, edits] of groups) if (!sharedGroupValid(edits)) invalid.add(id)
      for (const [id, entry] of Array.from(attached).reverse()) {
        if (sessionEntry(entry)) continue
        const edit = saved.get(editId(id, entry))
        const pairedTemplateChanged = edit?.template && edit.group && groups.get(edit.group)?.some(member =>
          sameTemplateSource(member, entry.node) !== true)
        if (!inState(edit, state) || invalid.has(edit?.group) || !isAttached(edit, entry) || pairedTemplateChanged) detach(id)
      }
    }

    function pendingTextStyles() {
      return [...projectTextStyles(), ...Array.from(saved.values()).flatMap(edit => edit.pendingTextStyle ? [edit.pendingTextStyle] : [])]
    }

    function sameReplayTarget(earlier, edit, node) {
      if (earlier.template || edit.template) {
        return earlier.template === edit.template && earlier.templateSourceFingerprint === edit.templateSourceFingerprint &&
          earlier.target.tag === edit.target.tag && earlier.target.slot === edit.target.slot
      }
      if (earlier.route !== edit.route || earlier.frameState !== edit.frameState) return false
      const live = original.get(earlier.id)
      if (live?.node.isConnected) return live.node === node && matchesTarget(node, live.target)
      return earlier.restore === 'unique' && edit.restore === 'unique' &&
        JSON.stringify(earlier.target) === JSON.stringify(edit.target)
    }

    // Hiding 8 → 12 must still allow a later 12 → 16 on that exact setting.
    // Conversely, an edit made at 8 while 12 was hidden must still win when
    // 12 is shown again. Only extend the chain from a verified live baseline.
    function matchesBaseline(edit, node, actual, expected) {
      if (actual === expected) return true
      const reachable = new Set([actual])
      const stack = inlineStacks.get(node)?.get(edit.property)
      const top = stack?.at(-1)
      const owned = top && (edit.property === 'button-size'
        ? ui.buttonSize.currentSize(node, edit.target.key) === top.requested : ownsDeclaration(top))
      let earlierTop = !top
      for (const earlier of saved.values()) {
        if (earlier.id === edit.id) break
        if (earlier.property !== edit.property) continue
        const entry = earlier.template ? templateIndex.get(earlier.id)?.get(node)?.[1] : attached.get(earlier.id)
        if (owned && entry?.node === node) {
          reachable.add(entry.before)
          if (entry === top) earlierTop = true
        }
        if (earlier.previewHidden && reachable.has(earlier.before) && sameReplayTarget(earlier, edit, node)) {
          reachable.add(earlier.observed)
        }
      }
      return earlierTop && reachable.has(expected)
    }

    function templateCanRestore(edits, node, layers) {
      return edits.every((edit, index) => !layers[index] && !conflicted(edit, node) && canEdit(node, edit.property) &&
        sameTemplateSource(edit, node) !== false && matchesBaseline(edit, node, getComputedStyle(node).getPropertyValue(edit.property), edit.before))
    }

    function templateEntries(edits, node) {
      return edits.map(edit => templateIndex.get(edit.id)?.get(node))
    }

    async function restoreTemplate(edits, isCurrent) {
      const first = edits[0]
      const nodes = templateNodes(first).filter(node => templateCanRestore(edits, node, templateEntries(edits, node)))
      await Promise.all(nodes.flatMap(node => edits.map(edit => {
        const source = savedTemplateSource(edit, node)
        return typeof source === 'string' ? sourceFingerprint(source).ready : undefined
      })))
      const matching = nodes.filter(node => edits.every(edit => sameTemplateSource(edit, node)))
      for (const node of matching) {
        if (!isCurrent()) return
        const current = () => isCurrent() && templateMatches(first, node)
        const applied = []
        const baselines = []
        try {
          for (const edit of edits) {
            const before = getComputedStyle(node).getPropertyValue(edit.property)
            if (!current() || !sameTemplateSource(edit, node) || !canEdit(node, edit.property) ||
                !matchesBaseline(edit, node, before, edit.before)) break
            baselines.push(before)
            const entry = await apply(node, edit, current)
            if (!entry) break
            applied.push(entry)
          }
        } catch {
          // A peer can have its own layout constraints. Keep the saved intent.
        }
        if (applied.length === edits.length && current() && applied.every((entry, index) =>
          entry.before === baselines[index] && ownsDeclaration(entry) && sameTemplateSource(edits[index], node, entry))) {
          applied.forEach((entry, index) => attachTemplate(edits[index], entry))
        } else {
          for (const entry of applied.reverse()) remove(entry)
        }
      }
    }

    async function restore(isCurrent, fromOriginal = false) {
      projectPrepared()
      const exactNodes = fromOriginal ? original : new Map()
      // Retain exact references for hidden session-only edits across comparison.
      const groups = operations()
      const state = currentState()
      prune(groups, state)
      const definitions = new Map(pendingTextStyles().map(style => [style.name, style]))
      for (const edits of groups.values()) {
        if (!isCurrent()) return
        if (edits[0].prepared || edits[0].executor === 'authored-source' || edits[0].previewHidden) continue
        if (edits[0].template) {
          await restoreTemplate(edits, isCurrent)
          continue
        }
        if (!inState(edits[0], state) || !sharedGroupValid(edits)) continue
        const groupCurrent = () => isCurrent() && (!edits[0].frameState || inState(edits[0], readFrameState()))
        const pendingTextStyle = edits[0].pendingTextStyle ?? definitions.get(edits[0].pendingTextStyleName)
        const applied = []
        let complete = true
        for (const edit of edits) {
          if (attached.has(edit.id)) continue
          if (edit.target.mount) {
            const node = ui.componentEdits.liveNode(edit.target)
            if (!node) { complete = false; break }
            const actual = await ui.componentEdits.read(edit.target, savedRoute)
            if (ui.componentEdits.equal(actual, edit.afterState)) {
              applied.push([edit.id, { ...edit, node, liveTarget: edit.target, path: savedRoute }])
            } else if (fromOriginal && ui.componentEdits.equal(actual, edit.beforeState)) {
              const entry = await apply(node, edit, groupCurrent).catch(() => null)
              if (entry) applied.push([edit.id, entry])
              else complete = false
            } else complete = false
            break
          }
          const exact = exactNodes.get(edit.id)
          if (edit.restore === 'session' && (!exact || !matchesTarget(exact.node, exact.target))) {
            complete = false
            break
          }
          const exactMatch = matchesTarget(exact?.node, exact?.target)
          const node = exactMatch ? exact.node : (edit.restore === 'unique' ? await resolveSavedNode(edit, groupCurrent) : null)
          if (conflicts.has(edit.id) || !node) {
            complete = false
            break
          }
          try {
            const identity = describe(node)
            lastResolved.set(edit, { node, identity })
            const before = edit.restore === 'session'
              ? ui.buttonSize.currentSize(node, edit.target.key)
              : getComputedStyle(node).getPropertyValue(edit.property)
            if (!canEdit(node, edit.property) || !matchesBaseline(edit, node, before, exactMatch ? exact.before : edit.before)) {
              complete = false
              break
            }
            const replay = edit.property === 'button-size' ? { ...edit, before } :
              pendingTextStyle ? { ...edit, pendingTextStyle } : edit
            const entry = await apply(node, replay, groupCurrent)
            if (!entry || !groupCurrent() || !matchesTarget(node, identity, true) || !isAttached(edit, entry)) {
              if (sessionEntry(entry)) await removeButtonSize(entry).catch(() => false)
              else if (entry) remove(entry)
              complete = false
              break
            }
            applied.push([edit.id, entry])
          } catch {
            complete = false
            break
          }
        }
        if (!complete || !isCurrent() || !sharedGroupValid(edits)) {
          for (const [, entry] of applied.reverse()) {
            if (sessionEntry(entry)) await removeButtonSize(entry).catch(() => false)
            else remove(entry)
          }
          if (edits[0].group && isCurrent()) {
            for (const edit of [...edits].reverse()) detach(edit.id)
          }
          continue
        }
        for (const [id, entry] of applied) {
          attach(id, entry)
          original.delete(id)
        }
        reconcileConflicts(applied.map(([, entry]) => entry))
      }
    }

    function visible(node) {
      return node?.isConnected && node.getClientRects().length &&
        getComputedStyle(node).visibility === 'visible' &&
        !node.closest('[data-localhost-inspector-layer-hidden]')
    }

    function entryShowsEffect(edit, entry) {
      if (edit.target.kind === 'text')
        return ui.textEditing.resolve(edit.target.mount)?.data === edit.afterState.value
      // Registered slots and source props have a separate confirmation protocol.
      if (edit.target.mount) return true
      if (edit.property === 'button-size')
        return ui.buttonSize.currentSize(entry.node, edit.target.key) === edit.requested
      return !lostPreview(entry)
    }

    function observeMember(edit, hidden, state) {
      if (!inState(edit, state)) return { state: 'unobservable' }
      if (edit.prepared) return ui.preparedPreview.observe(edit, visible, hidden)
      if (edit.executor === 'authored-source') {
        const latest = [...saved.values()].findLast(member => member.authoredBinding?.id === edit.authoredBinding.id)
        return ui.authoredUsePreview.observe(edit, hidden, latest)
      }
      const resolved = lastResolved.get(edit)
      const exact = attached.get(edit.id)?.node ?? original.get(edit.id)?.node ??
        (resolved && matchesTarget(resolved.node, resolved.identity, true) &&
          findTarget(edit.target, resolved.node) === resolved.node ? resolved.node : null)
      const candidates = edit.template ? templateNodes(edit).filter(visible) : [exact].filter(visible)
      const nodes = edit.template && !hidden
        ? candidates.filter(node => sameTemplateSource(edit, node) === true) : candidates
      if (edit.template && candidates.length && !nodes.length &&
          candidates.every(node => sameTemplateSource(edit, node) === false)) return { state: 'stale' }
      if (!nodes.length) return { state: hidden ? 'hidden' : 'unobservable' }
      const results = nodes.map(node => {
        if (hidden) return 'hidden'
        const entry = edit.template ? templateIndex.get(edit.id)?.get(node)?.[1] : attached.get(edit.id)
        if (!entry || !isAttached(edit, entry)) return 'failed'
        const top = inlineStacks.get(node)?.get(edit.property)?.at(-1)
        if (top && top !== entry) {
          const winner = saved.get(entryIds.get(top))
          return isAttached(winner, top) && entryShowsEffect(winner, top) ? 'superseded' : 'failed'
        }
        return entryShowsEffect(edit, entry) ? 'applied' : 'failed'
      })
      const status = ['failed', 'hidden', 'superseded', 'applied'].find(value => results.includes(value))
      return { state: status, node: nodes[0] }
    }

    function operation(id) {
      const edit = saved.get(id)
      if (!edit || !edit.group) return edit ? [edit] : undefined
      return operations().get(id)
    }

    function observeOperation(edits, comparing, state) {
      if (!edits) return { state: 'unobservable' }
      const results = edits.map(edit => observeMember(edit, comparing || edit.previewHidden, state))
      const status = ['stale', 'failed', 'hidden', 'unobservable', 'superseded', 'applied']
        .find(value => results.some(result => result.state === value))
      return { state: status, node: results.find(result => result.state === status)?.node ??
        results.find(result => result.node)?.node }
    }

    return {
      projectPrepared,
      ownsLiveProperty(node, property) {
        const entry = inlineStacks.get(node)?.get(property)?.at(-1)
        return Boolean(entry && ownsDeclaration(entry))
      },
      componentEntries(id) {
        return Array.from(attached).reverse().filter(([key, entry]) => sessionEntry(entry) && (!id || id === key))
          .map(([, entry]) => entry)
      },
      pendingColorFor(node) {
        const entry = Array.from(attached.values()).findLast(
          entry => entry.node === node && entry.property === 'background-color',
        )
        return entry?.pendingColor && !lostPreview(entry) ? entry.pendingColor : null
      },
      hasVerticalPaddingPreview(node) {
        return Array.from(attached.values()).some(entry =>
          entry.node === node && ui.sharedPadding.properties.includes(entry.property),
        )
      },
      pendingTextStyles,
      templateSource,
      pendingTextStyleFor(node) {
        const entries = topEntries().filter(entry => entry.node === node && ui.textStyleProperties.includes(entry.property))
        const pending = entries[0]?.pendingTextStyle
        return pending && entries.length === ui.textStyleProperties.length &&
          entries.every(entry => entry.pendingTextStyle?.name === pending.name && !lostPreview(entry)) ? pending : null
      },
      get hasAttached() { return attached.size > 0 || Array.from(saved.values()).some(edit => edit.prepared && !edit.previewHidden && ui.preparedPreview.locate(edit)) },
      get hasAttachedButtonSize() {
        return Array.from(attached.values()).some(entry => entry.property === 'button-size')
      },
      observeOperation(id, comparing) {
        return observeOperation(operation(id), comparing, currentState())
      },
      async locateSavedEdit(id, isCurrent, comparing) {
        const edits = operation(id)
        if (!edits) return { state: 'unobservable' }
        const observation = observeOperation(edits, comparing, currentState())
        const [edit] = edits
        if (observation.state === 'applied' && edit.target.mount) {
          const actual = await ui.componentEdits.read(edit.target, savedRoute).catch(() => null)
          if (!isCurrent() || saved.get(edit.id) !== edit || !visible(observation.node))
            return { state: 'unobservable' }
          if (!ui.componentEdits.equal(actual, edit.afterState)) return { ...observation, state: 'failed' }
        }
        if (observation.node || observation.state === 'stale' || edit.prepared || edit.executor === 'authored-source' ||
            (edit.frameState && !inState(edit, readFrameState()))) return observation
        const current = () => isCurrent() && saved.get(edit.id) === edit &&
          (!edit.frameState || inState(edit, readFrameState()))
        const exact = original.get(edit.id)
        const node = exact && matchesTarget(exact.node, exact.target) &&
            (edit.restore !== 'unique' || findTarget(edit.target, exact.node) === exact.node) ? exact.node :
          !edit.template && edit.restore === 'unique' ? await resolveSavedNode(edit, current) : null
        if (!current() || !visible(node)) return observation
        return { node, state: comparing || edit.previewHidden ? 'hidden' : 'failed' }
      },
      matchesSnapshot(edits) {
        return edits.length === saved.size && edits.every(edit => saved.get(edit.id)?.before === edit.before &&
          saved.get(edit.id)?.sourceState === edit.sourceState)
      },
      get hasSessionPreview() {
        return Array.from(attached).some(([id, entry]) => saved.get(editId(id, entry))?.restore !== 'unique')
      },
      get hasSaved() { return Boolean(this.lastSavedId) },
      get hasRecords() { return saved.size > 0 },
      get hasScopedEdits() { return hasScopedEdits() },
      get hasTemplateEdits() { return Array.from(saved.values()).some(edit => edit.template) },
      changedBaseline(id, node) {
        const edit = saved.get(id)
        if (!edit || sessionEntry(edit)) return null
        const value = getComputedStyle(node).getPropertyValue(edit.property)
        return value !== edit.before && value !== edit.observed
          ? { label: edit.property.replaceAll('-', ' '), value } : null
      },
      recoveryStates() {
        const state = currentState()
        return Array.from(operations().values(), edits => {
          const result = observeOperation(edits, false, state)
          const [edit] = edits
          if (result.state === 'unobservable' && (edit.prepared || edit.executor === 'authored-source' || edit.route !== savedRoute)) return null
          if (result.state === 'stale' && edit.prepared) return 'prepared-stale'
          if (result.state === 'stale' && edit.executor === 'authored-source') return 'authored-stale'
          return result.state
        })
      },
      get hasConflicts() { return [...conflicts].some(id => !saved.get(id)?.previewHidden) },
      get lastSavedId() {
        return Array.from(saved.values()).findLast(edit => edit.route === savedRoute ||
          (edit.executor === 'authored-source' && ui.authoredUsePreview.members(edit.authoredBinding).length > 0) ||
          (edit.prepared && ui.preparedPreview.locate(edit)) ||
          (edit.template && templateNodes(edit).some(node => sameTemplateSource(edit, node) !== false)))?.id
      },
      get needsRestore() {
        if (hasStyleConflict()) return true
        const state = currentState()
        return Array.from(operations().values()).some(edits => {
          if (edits[0].prepared || edits[0].executor === 'authored-source' || edits[0].previewHidden) return false
          if (!sharedGroupValid(edits)) return edits.some(edit => attached.has(edit.id))
          if (edits[0].template) {
            return edits.some(edit => templateLayers(edit.id).some(([, entry]) =>
              !isAttached(edit, entry) || edits.some(member => conflicted(member, entry.node)))) ||
              templateNodes(edits[0]).some(node => templateCanRestore(edits, node, templateEntries(edits, node)))
          }
          return edits.some(edit => {
            const entry = attached.get(edit.id)
            if (!inState(edit, state)) return Boolean(entry)
            if (entry) return !sessionEntry(entry) && !isAttached(edit, entry)
            return !conflicts.has(edit.id) && edit.restore === 'unique' && candidatesFor(edit.target).length > 0
          })
        })
      },
      hasStyleConflict,
      hasTargetClassChange(records) {
        const ids = new Set(records.filter(record => record.attributeName === 'class').map(record => record.target.id).filter(Boolean))
        return ids.size > 0 && Array.from(saved.values()).some(edit => edit.target.classFingerprint && ids.has(edit.target.id))
      },
      remember(edit, entry, peers = []) {
        saved.set(edit.id, edit)
        if (!entry) return
        if (edit.template) for (const member of [entry, ...peers]) attachTemplate(edit, member)
        else attach(edit.id, entry)
        reconcileConflicts([entry, ...peers])
      },
      forget,
      hasUnverifiedDependentPreview(id) {
        const group = operations().get(id)
        if (!group) return false
        const members = new Set(group.map(edit => edit.id))
        const next = []
        for (const [member, edit] of [...saved].reverse()) {
          const entries = edit.template ? templateLayers(member).map(([, entry]) => entry) : [attached.get(member)].filter(Boolean)
          if (!members.has(member)) {
            for (const entry of entries) next.push({ edit, entry })
          } else if (entries.some(entry => next.some(candidate => candidate.entry.node === entry.node &&
            candidate.edit.property === edit.property && (Boolean(edit.template) !== Boolean(candidate.edit.template) ||
              edit.restore !== 'unique' || candidate.edit.restore !== 'unique')))) return true
        }
        return false
      },
      async removeOperation(id, rebased, isCurrent) {
        reconcileConflicts()
        if (saved.get(id)?.template && rebased.length) {
          const edit = saved.get(id)
          for (const [layer, entry] of [...attached].reverse()) {
            const peer = saved.get(entry.templateEditId)
            if (peer?.template === edit.template && peer.templateSourceFingerprint === edit.templateSourceFingerprint &&
                entry.property === edit.property) detach(layer)
          }
        }
        const removed = attached.get(id)
        if (removed && rebased.length) {
          // Unwind this declaration's later layers before removing its baseline.
          const later = Array.from(attached).slice(Array.from(attached.keys()).indexOf(id) + 1)
          for (const [member, entry] of later.reverse()) {
            if (entry.node === removed.node && entry.property === removed.property) detach(member)
          }
        }
        forget(id)
        for (const { id: member, before } of rebased) {
          const edit = saved.get(member)
          if (edit) saved.set(member, { ...edit, before })
        }
        if (rebased.length) await restore(isCurrent)
      },
      hasPreparedOperation(id) { return Boolean(saved.get(id)?.prepared) },
      hasOperation(id) { return saved.has(id) },
      isPreviewHidden(id) { return saved.get(id)?.previewHidden === true },
      async setPreviewHidden(changes, isCurrent, comparing = false) {
        const changed = [...saved.values()].filter(edit => changes.has(edit.group ?? edit.id) &&
          Boolean(edit.previewHidden) !== changes.get(edit.group ?? edit.id))
        if (!changed.length) return
        if (!comparing) this.showOriginal()
        for (const edit of changed) saved.set(edit.id, { ...edit, previewHidden: changes.get(edit.group ?? edit.id) })
        if (!comparing) await restore(isCurrent, true)
      },
      showOriginal() {
        ui.preparedPreview.project([])
        reconcileConflicts()
        for (const [id, entry] of Array.from(attached).reverse()) {
          detach(id)
          if (entry.templateEditId) continue
          // A named edit’s original value may depend on the app’s current styles.
          // Use the baseline we just exposed only for the same mounted node.
          const before = entry.colorToken || entry.pendingColor || entry.spacingToken || entry.textStyleToken || entry.pendingTextStyle
            ? getComputedStyle(entry.node).getPropertyValue(entry.property) : entry.before
          original.set(id, { node: entry.node, before, target: entry.liveTarget })
        }
      },
      clear,
      load,
      restore,
    }
  }
})()
