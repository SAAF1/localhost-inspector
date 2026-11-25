import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import { declaresVariable, validRoute } from './journal-values.mjs'
import { pendingEdits, removePendingEdit, setPreviewVisibility } from './journal-edits.mjs'

export function journalSnapshot(message, journal, journalRoute, buttonSize, authoredUse = false) {
  if (!validRoute(message.route)) throw Error('Expected a route')
  const route = journalRoute(message.route)
  const visibleEdits = journal.edits.filter(edit => edit.route === route || edit.template || edit.prepared)
    .map(edit => {
      if (edit.executor !== 'authored-source') return edit
      const { patch, ...sourceReceipt } = edit.sourceReceipt
      return { ...edit, sourceReceipt }
    })
  return { revision: journal.revision, route, preparedPreviews: true, scopedPreviewTargets: true, landmarkPreviewTargets: true, sectionPreviewTargets: true, templatePreviews: true,
    templateSourcePreviews: true, templatePaddingPreviews: true, projectWideRevert: true, ...(authoredUse ? { authoredUse: true } : {}), previewVisibility: true,
    textStyleDefinitions: journal.textStyleDefinitions ?? [],
    ...(message.forComponentReset === true ? { componentEdits: journal.edits.filter(edit => edit.target.mount) } : {}),
    edits: visibleEdits, pending: pendingEdits(journal.edits), buttonSizeKey: buttonSize?.key }
}

export function requireRevision(message, journal) {
  if (!Number.isSafeInteger(message.expectedRevision) || message.expectedRevision !== journal.revision) {
    const error = Error('Saved previews changed in another tab. Reload the page and try again.')
    error.code = 'STALE_JOURNAL'
    throw error
  }
}

export async function applyJournalOperation(message, journal, { validators, journalRoute, readCatalog, readButtonSize }) {
  const { groupedPaddingEdits, componentPropertyEdit, buttonSizeEdit, validateTextStyleDefinition, textStyleEdits, editFrom } = validators
  let removed = []
  let rebased
  let definition
  if (message.type === 'saveTextStyleDefinition') {
    definition = await validateTextStyleDefinition(message.definition, await readCatalog('text-styles'), journal)
    journal.textStyleDefinitions ??= []
    journal.textStyleDefinitions.push(definition)
  } else if (message.type === 'save') {
    const catalog = message.record?.spacingToken ? await readCatalog('spacing') :
      message.record?.colorToken || message.record?.pendingColor ? await readCatalog('colors') : null
    const edit = editFrom(message.record, catalog)
    if (journal.edits.some(e => e.id === edit.id)) return { value: { revision: journal.revision } }
    if (edit.pendingColor) {
      const { name } = edit.pendingColor
      await access(catalog.file, constants.W_OK).catch(() => { throw Error('The color source is read-only.') })
      if (declaresVariable(catalog.css, name) ||
        journal.edits.some(entry => entry.pendingColor?.name === name)) {
        throw Error('That variable name is already in use.')
      }
    }
    journal.edits.push(edit)
  } else if (message.type === 'saveButtonSize' || message.type === 'saveComponentProperty') {
    const edit = message.type === 'saveButtonSize' ? buttonSizeEdit(message.record, await readButtonSize()) : componentPropertyEdit(message.record)
    if (journal.edits.some(entry => entry.id === edit.id)) return { value: { revision: journal.revision } }
    journal.edits.push(edit)
  } else if (message.type === 'saveSharedPadding' || message.type === 'savePairedPadding') {
    const catalog = Array.isArray(message.records) && message.records.some(record => record?.spacingToken) ? await readCatalog('spacing') : null
    journal.edits.push(...groupedPaddingEdits(message.records, catalog, journal, message.type === 'saveSharedPadding'))
  } else if (message.type === 'saveSelectionPaint') {
    if (!Array.isArray(message.records) || message.records.length < 2) throw Error('Invalid selection color edit')
    const edits = message.records.map(record => editFrom(record, null))
    const first = edits[0]
    const ids = new Set(edits.map(edit => edit.id))
    if (ids.size !== edits.length || journal.edits.some(edit => ids.has(edit.id)) || edits.some(edit =>
      (edit.intent !== 'selected occurrence only' || edit.route !== first.route || edit.requested !== first.requested ||
        edit.frameState !== first.frameState || !/^(color|fill|stroke|background-color|outline-color|border-(top|right|bottom|left)-color)$/.test(edit.property)))) {
      throw Error('Invalid selection color edit')
    }
    for (const edit of edits) journal.edits.push({ ...edit, group: first.id })
  } else if (message.type === 'saveTextStyle') {
    const first = message.records?.[0]
    const catalog = first?.textStyleToken || first?.pendingTextStyle || first?.pendingTextStyleName ? await readCatalog('text-styles') : null
    journal.edits.push(...await textStyleEdits(message.records, catalog, journal))
  } else if (message.type === 'setPreviewVisibility') {
    const edits = setPreviewVisibility(journal.edits, message.id, message.hidden)
    if (edits === journal.edits) return { value: { revision: journal.revision, pending: pendingEdits(edits) } }
    journal.edits = edits
  } else if (message.type === 'removeEdit') {
    const result = removePendingEdit(journal.edits, message.id)
    journal.edits = result.edits
    removed = result.removed
    rebased = result.rebased
  } else if (message.type === 'undo') {
    const edit = journal.edits.find(e => e.id === message.id)
    if (!edit) throw Error('Edit was not found')
    const matches = member => member === edit || (edit.group && member.group === edit.group)
    removed = journal.edits.filter(matches)
    journal.edits = journal.edits.filter(member => !matches(member))
  } else if (message.type === 'resetAll') {
    removed = journal.edits
    journal.edits = []
  } else if (message.type === 'reset') {
    if (!validRoute(message.route)) throw Error('Expected a route')
    const route = journalRoute(message.route)
    const visible = Array.isArray(message.templateIds) ? new Set(message.templateIds) : new Set()
    const matches = edit => edit.route === route || (edit.template && visible.has(edit.id))
    removed = journal.edits.filter(matches)
    journal.edits = journal.edits.filter(edit => !matches(edit))
  } else throw Error('Unknown operation')
  journal.revision++
  return { changed: true, removed, value: { revision: journal.revision, pending: pendingEdits(journal.edits), rebased, definition } }
}
