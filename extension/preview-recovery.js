(() => {
  const ui = window.LocalhostInspector
  const keyAttribute = 'data-inspector-target'
  const normalize = text => (text ?? '').trim().replace(/\s+/g, ' ')

  function targetKey(node) {
    const key = node.getAttribute(keyAttribute)
    return key?.trim() && key.length <= 120 ? key : null
  }

  const describe = node => ({
    tag: node.localName,
    id: node.id || null,
    slot: node.getAttribute('data-slot'),
    text: normalize(node.innerText).slice(0, 100),
    key: targetKey(node),
  })

  function matchesTarget(node, target, rebind = false) {
    if (!node?.isConnected || node.localName !== target.tag ||
        node.getAttribute('data-slot') !== target.slot) return false
    const key = targetKey(node)
    if (target.key || key) return key === target.key
    if ((node.id || null) !== target.id) return false
    // A live ID-bearing node can outlast changes to its descendants. A new
    // node found through a legacy ID still needs the recorded text guard.
    return (!rebind && Boolean(target.id)) || !target.text ||
      normalize(node.innerText).slice(0, 100) === target.text
  }

  function findTarget(target, liveNode) {
    if (!target.key && !target.id) return null
    const selector = target.key
      ? '[' + keyAttribute + '="' + CSS.escape(target.key) + '"]'
      : '#' + CSS.escape(target.id)
    const matches = document.querySelectorAll(selector)
    if (matches.length !== 1) return null
    const [node] = matches
    return matchesTarget(node, target, node !== liveNode) ? node : null
  }

  function ownsDeclaration({ node, property, requested }) {
    return node.style.getPropertyValue(property) === requested &&
      node.style.getPropertyPriority(property) === ''
  }

  ui.describePreviewTarget = describe
  ui.findPreviewTarget = findTarget
  ui.matchesPreviewTarget = matchesTarget
  ui.ownsPreviewDeclaration = ownsDeclaration
  ui.createPreviewRecovery = ({ apply, remove, canEdit }) => {
    const saved = new Map()
    const attached = new Map()
    const conflicts = new Set()
    let original = new Map()

    function detach(id) {
      const entry = attached.get(id)
      if (!entry) return
      remove(entry)
      attached.delete(id)
    }

    function topEntries() {
      const byNode = new Map()
      for (const entry of attached.values()) {
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
      if (entry.textStyleToken) return !ui.textStyleMatches(
        getComputedStyle(entry.node).getPropertyValue(entry.property),
        ui.textStyleValues(entry.node, entry.textStyleToken.name)?.[entry.property],
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
        if (!lostPreview(entry)) continue
        const ownsInline = ownsDeclaration(entry)
        for (const [id, layer] of Array.from(attached).reverse()) {
          if (layer.node !== entry.node || layer.property !== entry.property) continue
          // When the app took ownership of the declaration, even a value equal
          // to an earlier preview layer belongs to the app now.
          if (ownsInline) detach(id)
          else attached.delete(id)
          conflicts.add(id)
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
      original.clear()
    }

    function load(edits) {
      saved.clear()
      for (const edit of edits) saved.set(edit.id, edit)
      for (const id of conflicts) {
        if (!saved.has(id)) conflicts.delete(id)
      }
    }

    function isAttached(edit, entry) {
      return Boolean(edit && matchesTarget(entry.node, edit.target) &&
        (edit.restore !== 'unique' || findTarget(edit.target, entry.node) === entry.node))
    }

    function prune() {
      reconcileConflicts()
      for (const [id, entry] of Array.from(attached).reverse()) {
        if (!isAttached(saved.get(id), entry)) detach(id)
      }
    }

    async function restore(isCurrent, fromOriginal = false) {
      const exactNodes = fromOriginal ? original : new Map()
      if (fromOriginal) original = new Map()
      prune()
      const operations = new Map()
      for (const edit of saved.values()) {
        const id = edit.group ?? edit.id
        if (!operations.has(id)) operations.set(id, [])
        operations.get(id).push(edit)
      }
      for (const edits of operations.values()) {
        if (!isCurrent()) return
        const applied = []
        let complete = true
        for (const edit of edits) {
          if (attached.has(edit.id)) continue
          const exact = exactNodes.get(edit.id)
          const exactMatch = matchesTarget(exact?.node, edit.target)
          const node = exactMatch ? exact.node : (edit.restore === 'unique' ? findTarget(edit.target) : null)
          if (conflicts.has(edit.id) || !node || !canEdit(node, edit.property) ||
              getComputedStyle(node).getPropertyValue(edit.property) !== (exactMatch ? exact.before : edit.before)) {
            complete = false
            break
          }
          try {
            const entry = await apply(node, edit, isCurrent)
            if (!entry || !isCurrent() || !isAttached(edit, entry)) {
              if (entry) remove(entry)
              complete = false
              break
            }
            applied.push([edit.id, entry])
          } catch {
            complete = false
            break
          }
        }
        if (!complete || !isCurrent()) {
          for (const [, entry] of applied.reverse()) remove(entry)
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
      pendingColorFor(node) {
        const entry = Array.from(attached.values()).findLast(
          entry => entry.node === node && entry.property === 'background-color',
        )
        return entry?.pendingColor && !lostPreview(entry) ? entry.pendingColor : null
      },
      get hasAttached() { return attached.size > 0 },
      get hasSaved() { return saved.size > 0 },
      get hasUnattached() { return attached.size < saved.size },
      get hasConflicts() { return conflicts.size > 0 },
      get lastSavedId() { return Array.from(saved.keys()).at(-1) },
      get needsRestore() {
        return hasStyleConflict() || Array.from(saved.values()).some(edit => {
          const entry = attached.get(edit.id)
          if (entry) return !isAttached(edit, entry)
          return !conflicts.has(edit.id) && edit.restore === 'unique' && Boolean(findTarget(edit.target))
        })
      },
      hasStyleConflict,
      remember(edit, entry) {
        saved.set(edit.id, edit)
        if (!entry) return
        attached.set(edit.id, entry)
        reconcileConflicts([entry])
      },
      forget(id) {
        reconcileConflicts()
        const group = saved.get(id)?.group
        const ids = group ? Array.from(saved.values()).filter(edit => edit.group === group).map(edit => edit.id) : [id]
        for (const member of ids.reverse()) {
          detach(member)
          saved.delete(member)
          conflicts.delete(member)
        }
      },
      showOriginal() {
        reconcileConflicts()
        original = new Map()
        for (const [id, entry] of Array.from(attached).reverse()) {
          detach(id)
          // A named edit’s original value may depend on the app’s current styles.
          // Use the baseline we just exposed only for the same mounted node.
          const before = entry.colorToken || entry.pendingColor || entry.spacingToken || entry.textStyleToken
            ? getComputedStyle(entry.node).getPropertyValue(entry.property) : entry.before
          original.set(id, { node: entry.node, before })
        }
      },
      clear,
      load,
      restore,
    }
  }
})()
