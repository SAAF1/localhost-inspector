(() => {
  const ui = window.LocalhostInspector
  const keyAttribute = 'data-inspector-target'
  // A repeated marker names one authored template part. Occurrence keys still identify individual records.
  const templateAttribute = 'data-inspector-template'
  const contextAttribute = name => /^data-(?!inspector-|state$|slot$|theme$|active$|disabled$|open$|selected$|highlighted$|hovered$)/.test(name)
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

  function explicitRole(node) {
    const role = node.getAttribute('role')?.trim().split(/\s+/, 1)[0]
    return role && role.length <= 20 ? role : undefined
  }

  function scopedAnchor(node, text) {
    // A repeated item needs its own authored identifier, even on a page
    // that currently has just one item.
    const repeated = 'tr, li, article, [role="row"], [role="listitem"], [role="option"], [role="article"]'
    if (!text) return null
    const semantic = node.matches('h1, h2, h3, h4, h5, h6, p, button, a, label, [role], [aria-label]')
    if (!semantic && node.childElementCount) return null
    const path = []
    for (let child = node; child.parentElement && path.length < 8; child = child.parentElement) {
      if (child.matches(repeated) || !/^[a-z][a-z0-9-]{0,39}$/.test(child.localName)) return null
      path.unshift(child.localName)
      const parent = child.parentElement
      const key = targetKey(parent)
      if (key) return { kind: 'key', value: key, path: path.join('>') }
      if (semantic && parent.id && parent.id.length <= 120) return { kind: 'id', value: parent.id, path: path.join('>') }
      if (semantic) {
        const landmark = Object.keys(landmarks).find(name => parent.matches(landmarks[name]))
        if (landmark) return { kind: landmark === 'main' ? 'main' : 'landmark', value: landmark, path: path.join('>') }
      }
    }
    return null
  }

  const sameAnchor = (a, b) => Boolean(a && b && a.kind === b.kind && a.value === b.value && a.path === b.path)

  function regionIdentity(node) {
    const regions = []
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

  function dataContext(node) {
    const evidence = []
    for (let depth = 0; node && depth < 6; depth++, node = node.parentElement) {
      const attrs = Array.from(node.attributes)
        .filter(attr => contextAttribute(attr.name))
        .map(attr => [attr.name, attr.value])
        .sort(([left], [right]) => left.localeCompare(right))
      if (attrs.length) evidence.push([depth, attrs])
    }
    return JSON.stringify(evidence)
  }

  function describe(node) {
    const key = targetKey(node)
    const id = node.id || null
    const text = labelOf(node)
    const anchor = !key && !id ? scopedAnchor(node, text) : null
    const guarded = !key && (id || anchor)
    return {
      tag: node.localName, id, key, slot: node.getAttribute('data-slot'), text,
      ...(anchor ? { anchor } : {}),
      region: guarded ? regionIdentity(node) : undefined,
      classes: guarded ? classIdentity(node) : undefined,
      context: guarded ? dataContext(node) : undefined,
    }
  }

  function matchesTarget(node, target, rebind = false) {
    if (!node?.isConnected || !target || node.localName !== target.tag ||
        node.getAttribute('data-slot') !== target.slot) return false
    const key = targetKey(node)
    if (target.key || key) return key === target.key
    if ((node.id || null) !== target.id || (target.region !== undefined && target.region !== regionIdentity(node))) return false
    if (target.anchor && !sameAnchor(target.anchor, scopedAnchor(node, labelOf(node)))) return false
    if (target.classes !== undefined && target.classes !== classIdentity(node)) return false
    if (target.context !== undefined && target.context !== dataContext(node)) return false
    // A live ID-bearing node can outlast changes to its descendants. A new
    // node found through a legacy ID still needs the recorded text guard.
    return (!rebind && Boolean(target.id)) || !target.text ||
      labelOf(node) === target.text
  }

  function candidatesFor(target) {
    if (target.anchor && !target.key && !target.id) {
      const { kind, value, path } = target.anchor
      if (!/^[a-z][a-z0-9-]{0,39}(>[a-z][a-z0-9-]{0,39}){0,7}$/.test(path)) return []
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
    const candidates = candidatesFor(target)
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
    if (contextFingerprint && await fingerprint(identity.context ?? '') !== contextFingerprint) return false
    return isCurrent() && findTarget(edit.target, node) === node && matchesTarget(node, identity, true)
  }

  async function resolveSavedNode(edit, isCurrent) {
    const { target } = edit
    let node = findTarget(target)
    if (!node && target.anchor && target.textFingerprint) {
      const labels = new Set(candidatesFor(target).map(labelOf))
      const checks = await Promise.all(Array.from(labels, async label => [label, await fingerprint(label)]))
      const match = checks.find(([, digest]) => digest === target.textFingerprint)
      if (match) node = findTarget({ ...target, text: match[0] })
    }
    return node && await verifySavedNode(edit, node, describe(node), isCurrent) ? node : null
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
  ui.templatePreview = { attribute: templateAttribute, of: templateOf }
  ui.createPreviewRecovery = ({ apply, remove, canEdit, removeButtonSize, readFrameState }) => {
    const saved = new Map()
    const attached = new Map()
    const conflicts = new Set()
    let templateConflicts = new WeakMap()
    let original = new Map()
    let savedRoute
    const inState = (edit, state) => !edit?.frameState || edit.frameState === state
    const hasScopedEdits = () => Array.from(saved.values()).some(edit => edit.frameState)
    const currentState = () => hasScopedEdits() ? readFrameState() : undefined
    const editId = (id, entry) => entry.templateEditId ?? id
    const templateLayers = id => Array.from(attached).filter(([, entry]) => entry.templateEditId === id)
    const templateMatches = (edit, node) => node.isConnected && templateOf(node) === edit.template &&
      node.localName === edit.target.tag && node.getAttribute('data-slot') === edit.target.slot
    const templateNodes = edit => Array.from(document.querySelectorAll(
      '[' + templateAttribute + '="' + CSS.escape(edit.template) + '"]',
    )).filter(node => node instanceof HTMLElement && templateMatches(edit, node) &&
      node.getClientRects().length && getComputedStyle(node).visibility === 'visible')
    const conflicted = (edit, node) => templateConflicts.get(node)?.has(edit.property)

    function attachTemplate(edit, entry) {
      entry.templateEditId = edit.id
      attached.set(Symbol(), entry)
    }

    function detach(id) {
      const entry = attached.get(id)
      if (!entry) return
      if (entry.property !== 'button-size') remove(entry)
      attached.delete(id)
    }

    function topEntries() {
      const byNode = new Map()
      for (const entry of attached.values()) {
        if (entry.property === 'button-size') continue
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
      for (const entry of entries) {
        if (entry.property === 'button-size' || !lostPreview(entry)) continue
        const ownsInline = ownsDeclaration(entry)
        for (const [id, layer] of Array.from(attached).reverse()) {
          if (layer.node !== entry.node || layer.property !== entry.property) continue
          // When the app took ownership of the declaration, even a value equal
          // to an earlier preview layer belongs to the app now.
          if (ownsInline) detach(id)
          else attached.delete(id)
          if (layer.templateEditId) {
            if (!templateConflicts.has(layer.node)) templateConflicts.set(layer.node, new Set())
            templateConflicts.get(layer.node).add(layer.property)
          } else conflicts.add(id)
        }
      }
    }

    function clearAttached() {
      for (const id of Array.from(attached.keys()).reverse()) detach(id)
    }

    function clear() {
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
      for (const id of conflicts) {
        if (!saved.has(id)) conflicts.delete(id)
      }
    }

    function isAttached(edit, entry) {
      if (edit?.template) return templateMatches(edit, entry.node)
      return Boolean(edit && matchesTarget(entry.node, entry.liveTarget) &&
        (edit.restore !== 'unique' || findTarget(edit.target, entry.node) === entry.node))
    }

    function forget(id) {
      reconcileConflicts()
      const group = saved.get(id)?.group
      const ids = group ? Array.from(saved.values()).filter(edit => edit.group === group).map(edit => edit.id) : [id]
      for (const member of ids.reverse()) {
        detach(member)
        for (const [layer] of templateLayers(member).reverse()) detach(layer)
        saved.delete(member)
        original.delete(member)
        conflicts.delete(member)
      }
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
        if (entry.property === 'button-size') continue
        const edit = saved.get(editId(id, entry))
        if (!inState(edit, state) || invalid.has(edit?.group) || !isAttached(edit, entry)) detach(id)
      }
    }

    function pendingTextStyles() {
      return Array.from(saved.values()).flatMap(edit => edit.pendingTextStyle ? [edit.pendingTextStyle] : [])
    }

    async function restoreTemplate(edit, isCurrent) {
      const existing = new Set(templateLayers(edit.id).map(([, entry]) => entry.node))
      for (const node of templateNodes(edit)) {
        if (!isCurrent()) return
        if (existing.has(node) || conflicted(edit, node) || !canEdit(node, edit.property) ||
            getComputedStyle(node).getPropertyValue(edit.property) !== edit.before) continue
        const current = () => isCurrent() && templateMatches(edit, node)
        try {
          const entry = await apply(node, edit, current)
          if (!entry) continue
          if (current()) attachTemplate(edit, entry)
          else remove(entry)
        } catch {
          // A peer can have its own layout constraints. Keep the saved intent.
        }
      }
    }

    async function restore(isCurrent, fromOriginal = false) {
      const exactNodes = fromOriginal ? original : new Map()
      if (fromOriginal) original = new Map()
      const groups = operations()
      const state = currentState()
      prune(groups, state)
      const definitions = new Map(pendingTextStyles().map(style => [style.name, style]))
      for (const edits of groups.values()) {
        if (!isCurrent()) return
        if (edits[0].template) {
          await restoreTemplate(edits[0], isCurrent)
          continue
        }
        if (!inState(edits[0], state) || !sharedGroupValid(edits)) continue
        const groupCurrent = () => isCurrent() && (!edits[0].frameState || inState(edits[0], readFrameState()))
        const pendingTextStyle = edits[0].pendingTextStyle ?? definitions.get(edits[0].pendingTextStyleName)
        const applied = []
        let complete = true
        for (const edit of edits) {
          if (attached.has(edit.id)) continue
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
            const before = edit.restore === 'session'
              ? ui.buttonSize.currentSize(node, edit.target.key)
              : getComputedStyle(node).getPropertyValue(edit.property)
            if (!canEdit(node, edit.property) || before !== (exactMatch ? exact.before : edit.before)) {
              complete = false
              break
            }
            const entry = await apply(node, pendingTextStyle ? { ...edit, pendingTextStyle } : edit, groupCurrent)
            if (!entry || !groupCurrent() || !matchesTarget(node, identity, true) || !isAttached(edit, entry)) {
              if (entry?.property === 'button-size') await removeButtonSize(entry).catch(() => false)
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
            if (entry.property === 'button-size') await removeButtonSize(entry).catch(() => false)
            else remove(entry)
          }
          if (edits[0].group && isCurrent()) {
            for (const edit of [...edits].reverse()) detach(edit.id)
          }
          continue
        }
        for (const [id, entry] of applied) attached.set(id, entry)
        reconcileConflicts(applied.map(([, entry]) => entry))
      }
    }

    return {
      buttonEntries(id) {
        return Array.from(attached).reverse().filter(([key, entry]) => entry.property === 'button-size' && (!id || id === key))
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
      pendingTextStyleFor(node) {
        const entries = topEntries().filter(entry => entry.node === node && ui.textStyleProperties.includes(entry.property))
        const pending = entries[0]?.pendingTextStyle
        return pending && entries.length === ui.textStyleProperties.length &&
          entries.every(entry => entry.pendingTextStyle?.name === pending.name && !lostPreview(entry)) ? pending : null
      },
      get hasAttached() { return attached.size > 0 },
      get hasAttachedButtonSize() {
        return Array.from(attached.values()).some(entry => entry.property === 'button-size')
      },
      previewNode(id) {
        const edit = saved.get(id)
        const entry = attached.get(id) ?? (edit?.template
          ? templateLayers(id).find(([, layer]) => isAttached(edit, layer) && layer.node.getClientRects().length)?.[1]
          : null)
        return entry && (!edit?.frameState || inState(edit, readFrameState())) && isAttached(edit, entry) ? entry.node : null
      },
      async locateSavedNode(id, isCurrent) {
        const edit = saved.get(id)
        if (!edit || (edit.frameState && !inState(edit, readFrameState()))) return null
        if (edit.template) return this.previewNode(id) ?? templateNodes(edit)[0] ?? null
        const targetCurrent = () => isCurrent() && (!edit.frameState || inState(edit, readFrameState()))
        const entry = attached.get(id)
        if (entry && isAttached(edit, entry)) return entry.node
        const exact = original.get(id)
        if (exact && matchesTarget(exact.node, exact.target) &&
            (edit.restore !== 'unique' || findTarget(edit.target, exact.node) === exact.node)) return exact.node
        if (edit.restore !== 'unique') return null
        const node = await resolveSavedNode(edit, targetCurrent)
        return saved.get(id) === edit ? node : null
      },
      matchesSnapshot(edits) {
        return edits.length === saved.size && edits.every(edit => saved.get(edit.id)?.before === edit.before)
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
        if (!edit || edit.property === 'button-size') return null
        const value = getComputedStyle(node).getPropertyValue(edit.property)
        return value !== edit.before && value !== edit.observed
          ? { label: edit.property.replaceAll('-', ' '), value } : null
      },
      get hasUnattached() {
        const state = currentState()
        return Array.from(saved.values()).some(edit => edit.template
          ? templateNodes(edit).some(node => !templateLayers(edit.id).some(([, entry]) => entry.node === node))
          : inState(edit, state) && !attached.has(edit.id))
      },
      get hasConflicts() { return conflicts.size > 0 },
      get lastSavedId() {
        return Array.from(saved.values()).findLast(edit => edit.route === savedRoute || (edit.template && templateNodes(edit).length))?.id
      },
      get needsRestore() {
        if (hasStyleConflict()) return true
        const state = currentState()
        return Array.from(operations().values()).some(edits => {
          if (!sharedGroupValid(edits)) return edits.some(edit => attached.has(edit.id))
          return edits.some(edit => {
            if (edit.template) {
              const entries = templateLayers(edit.id)
              return entries.some(([, entry]) => !isAttached(edit, entry)) ||
                templateNodes(edit).some(node => !conflicted(edit, node) && canEdit(node, edit.property) &&
                  !entries.some(([, entry]) => entry.node === node) &&
                  getComputedStyle(node).getPropertyValue(edit.property) === edit.before)
            }
            const entry = attached.get(edit.id)
            if (!inState(edit, state)) return Boolean(entry)
            if (entry) return entry.property !== 'button-size' && !isAttached(edit, entry)
            return !conflicts.has(edit.id) && edit.restore === 'unique' && candidatesFor(edit.target).length > 0
          })
        })
      },
      hasStyleConflict,
      hasTargetClassChange(records) {
        const ids = new Set(records.filter(record => record.attributeName === 'class').map(record => record.target.id).filter(Boolean))
        return ids.size > 0 && Array.from(saved.values()).some(edit => edit.target.classFingerprint && ids.has(edit.target.id))
      },
      remember(edit, entry) {
        saved.set(edit.id, edit)
        if (!entry) return
        if (edit.template) attachTemplate(edit, entry)
        else attached.set(edit.id, entry)
        reconcileConflicts([entry])
      },
      forget,
      hasUnverifiedDependentPreview(id) {
        const group = operations().get(id)
        if (!group) return false
        const members = new Set(group.map(edit => edit.id))
        const next = []
        for (const [member, edit] of [...saved].reverse()) {
          const entry = attached.get(member)
          if (!entry) continue
          if (!members.has(member)) next.push({ edit, entry })
          else if (next.some(candidate => candidate.entry.node === entry.node && candidate.edit.property === edit.property &&
            (edit.restore !== 'unique' || candidate.edit.restore !== 'unique'))) return true
        }
        return false
      },
      async removeOperation(id, rebased, isCurrent) {
        reconcileConflicts()
        if (saved.get(id)?.template && rebased.length) {
          const edit = saved.get(id)
          for (const [layer, entry] of [...attached].reverse()) {
            if (saved.get(entry.templateEditId)?.template === edit.template && entry.property === edit.property) detach(layer)
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
      showOriginal() {
        reconcileConflicts()
        original = new Map()
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
