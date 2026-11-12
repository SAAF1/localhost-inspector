(() => {
  const ui = window.LocalhostInspector
  const normalize = text => (text ?? '').trim().replace(/\s+/g, ' ')
  const describe = node => ({
    tag: node.localName,
    id: node.id || null,
    slot: node.getAttribute('data-slot'),
    text: normalize(node.innerText).slice(0, 100),
  })

  function matchesTarget(node, target) {
    if (!node?.isConnected) return false
    const current = describe(node)
    return current.tag === target.tag && current.id === target.id &&
      current.slot === target.slot && (!target.text || current.text === target.text)
  }

  function findTarget(target) {
    if (!target.id) return null
    const matches = document.querySelectorAll('#' + CSS.escape(target.id))
    return matches.length === 1 && matchesTarget(matches[0], target) ? matches[0] : null
  }

  ui.describePreviewTarget = describe
  ui.findPreviewTarget = findTarget
  ui.matchesPreviewTarget = matchesTarget
  ui.createPreviewRecovery = ({ apply, remove, canEdit }) => {
    const saved = new Map()
    const attached = new Map()
    let original = new Map()

    function detach(id) {
      const entry = attached.get(id)
      if (!entry) return
      remove(entry)
      attached.delete(id)
    }

    function clearAttached() {
      for (const id of Array.from(attached.keys()).reverse()) detach(id)
    }

    function clear() {
      clearAttached()
      saved.clear()
      original.clear()
    }

    function load(edits) {
      saved.clear()
      for (const edit of edits) saved.set(edit.id, edit)
    }

    function isAttached(edit, entry) {
      return matchesTarget(entry.node, edit.target) &&
        (edit.restore !== 'unique' || findTarget(edit.target) === entry.node)
    }

    function prune() {
      for (const [id, entry] of Array.from(attached).reverse()) {
        if (!isAttached(saved.get(id), entry)) detach(id)
      }
    }

    async function restore(isCurrent, fromOriginal = false) {
      const exactNodes = fromOriginal ? original : new Map()
      if (fromOriginal) original = new Map()
      prune()
      for (const edit of saved.values()) {
        if (!isCurrent()) return
        if (attached.has(edit.id)) continue
        const exact = exactNodes.get(edit.id)
        const node = matchesTarget(exact, edit.target) ? exact :
          (edit.restore === 'unique' ? findTarget(edit.target) : null)
        if (!node || !canEdit(node, edit.property) ||
            getComputedStyle(node).getPropertyValue(edit.property) !== edit.before) continue
        try {
          const entry = await apply(node, edit.property, edit.requested, isCurrent)
          if (!entry) continue
          if (!isCurrent() || !isAttached(edit, entry)) {
            remove(entry)
            continue
          }
          attached.set(edit.id, entry)
        } catch {
          // A target that no longer accepts its saved style must not block other previews.
        }
      }
    }

    return {
      get hasAttached() { return attached.size > 0 },
      get hasSaved() { return saved.size > 0 },
      get hasUnattached() { return attached.size < saved.size },
      get lastSavedId() { return Array.from(saved.keys()).at(-1) },
      get needsRestore() {
        return Array.from(saved.values()).some(edit => {
          const entry = attached.get(edit.id)
          if (entry) return !isAttached(edit, entry)
          return edit.restore === 'unique' && Boolean(findTarget(edit.target))
        })
      },
      remember(edit, entry) {
        saved.set(edit.id, edit)
        if (entry) attached.set(edit.id, entry)
      },
      forget(id) {
        detach(id)
        saved.delete(id)
      },
      showOriginal() {
        original = new Map(Array.from(attached, ([id, entry]) => [id, entry.node]))
        clearAttached()
      },
      clear,
      load,
      restore,
    }
  }
})()
