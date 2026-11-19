function operations(edits) {
  const groups = new Map()
  for (const edit of edits) {
    const id = edit.group ?? edit.id
    if (!groups.has(id)) groups.set(id, [])
    groups.get(id).push(edit)
  }
  return groups
}

export function pendingEdits(edits) {
  return Array.from(operations(edits), ([id, group]) => {
    const { route, target, property, before, requested, pendingTextStyle, textStyleToken, spacingToken, colorToken, frameState } = group[0]
    const pair = properties => properties.every(name => group.some(edit => edit.property === name))
    const label = pendingTextStyle?.name ?? textStyleToken?.name ?? spacingToken?.name ?? colorToken?.name
    return {
      id, route, frameState, sessionOnly: group.some(edit => edit.restore !== 'unique'), target: { id: target.id, tag: target.tag, slot: target.slot },
      property: pendingTextStyle || textStyleToken ? 'text-style' :
        pair(['padding-top', 'padding-bottom']) ? 'vertical-padding' :
        pair(['padding-left', 'padding-right']) ? 'horizontal-padding' : property,
      before, requested: label ?? requested,
    }
  })
}

function sameOccurrence(a, b) {
  const left = a.target
  const right = b.target
  if (a.route !== b.route || left.tag !== right.tag) return false
  if (left.slot !== right.slot) return false
  if (left.key || right.key) return Boolean(left.key && left.key === right.key)
  if (left.anchor && right.anchor) {
    return ['kind', 'value', 'path'].every(key => left.anchor[key] === right.anchor[key])
  }
  return left.id === right.id
}

function literal(edit) {
  return !edit.group && !edit.colorToken && !edit.spacingToken && !edit.pendingColor &&
    !edit.textStyleToken && !edit.pendingTextStyle && !edit.pendingTextStyleName && edit.property !== 'button-size' &&
    !edit.requested.startsWith('var(')
}

export function removePendingEdit(edits, id) {
  const group = operations(edits).get(id)
  if (!group) throw Error('Edit was not found')
  const removed = new Set(group.map(edit => edit.id))
  const rebase = new Map()
  for (const edit of group) {
    const later = edits.slice(edits.indexOf(edit) + 1).filter(entry => !removed.has(entry.id))
    const style = edit.pendingTextStyle?.name
    if (style && edits.some(entry => !removed.has(entry.id) && entry.pendingTextStyleName === style)) {
      throw Error('Remove edits using this text style first.')
    }
    const color = edit.pendingColor?.name
    if (color && edits.some(entry => !removed.has(entry.id) && entry.colorToken?.name === color)) {
      throw Error('Remove edits using this color first.')
    }
    const possible = later.filter(entry => sameOccurrence(edit, entry) && entry.property === edit.property)
    const guarded = next => edit.target.id || (edit.target.anchor && next.target.anchor)
    const sameVerifiedTarget = next => Boolean(edit.target.key || (guarded(next) && edit.target.regionFingerprint &&
      ['regionFingerprint', 'classFingerprint', 'textFingerprint'].every(key => edit.target[key] === next.target[key])))
    // A matching tag is weak evidence. A later baseline can only depend on an
    // unverified earlier edit if that edit actually changed the value saved.
    const next = possible.find(entry => sameVerifiedTarget(entry) ||
      (edit.before !== edit.observed && entry.before === edit.observed))
    if (!next) continue
    if (!sameVerifiedTarget(next)) {
      throw Error('Inspector can’t tell whether a newer edit uses this value. Remove the newer edit first.')
    }
    if (next.before !== edit.observed || !literal(edit) || !literal(next) || edit.restore !== 'unique' || next.restore !== 'unique') {
      throw Error('A newer edit on this element may use this value. Remove the newer edit first.')
    }
    rebase.set(next.id, edit.before)
  }
  return {
    edits: edits.filter(edit => !removed.has(edit.id))
      .map(edit => rebase.has(edit.id) ? { ...edit, before: rebase.get(edit.id) } : edit),
    removed: group,
    rebased: Array.from(rebase, ([id, before]) => ({ id, before })),
  }
}
