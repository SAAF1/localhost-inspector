import { unlink } from 'node:fs/promises'
import { pendingEdits } from './journal-edits.mjs'
import { targetFingerprint, validValue } from './journal-values.mjs'
import { planAuthoredUse, reverseAuthoredUse } from './scripts/flow/authored-use.mjs'
import { absent, authoredError, compile, conflict, patchText, replaceSource, requireWritableCandidate, revision, source } from './authored-source-file.mjs'

export { requireAuthoredCandidate } from './authored-source-file.mjs'
export const authoredExecutor = 'authored-source'
const operationId = id => typeof id === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)
const active = new Map()

function publicEdit(edit) {
  const { patch, ...sourceReceipt } = edit.sourceReceipt
  return { ...edit, sourceReceipt }
}

export function authoredResult(journal, edit) {
  return { revision: journal.revision, pending: pendingEdits(journal.edits), ...(edit ? { edit: publicEdit(edit) } : {}) }
}

function verifyObservation(edit, observed, evidence) {
  if (!observed || typeof observed !== 'object' || Array.isArray(observed) ||
      Object.keys(observed).length !== Object.keys(edit.authoredValues).length ||
      Object.entries(edit.authoredValues).some(([property, value]) => !validValue(property, observed[property]) ||
        observed[property] !== (property === 'color' ? edit.observed : value))) {
    throw authoredError('The rendered result did not match the authored edit.')
  }
  const { visibleMembers, protectedPeers, spacingRange } = evidence ?? {}
  const gap = Number.parseFloat(edit.authoredValues.gap)
  const spacing = edit.authoredBinding.family === 'spacing'
  if (!Number.isSafeInteger(visibleMembers) || visibleMembers < 1 ||
      !Number.isSafeInteger(protectedPeers) || protectedPeers < 0 ||
      (spacing ? !Array.isArray(spacingRange) || spacingRange.length !== 2 ||
        spacingRange.some(distance => !Number.isFinite(distance) || Math.abs(distance - gap) > 1) ||
        spacingRange[0] > spacingRange[1] : spacingRange !== undefined)) {
    throw authoredError('Expected visible member and protected-peer verification.')
  }
  return { visibleMembers, protectedPeers, ...(spacing ? { spacingRange } : {}) }
}

function validReceipt(plan) {
  if (!targetFingerprint(plan.beforeRevision) || !targetFingerprint(plan.afterRevision) ||
      plan.beforeRevision !== revision(plan.before) || plan.afterRevision !== revision(plan.after) ||
      patchText(plan.before, plan.patch) !== plan.after) {
    throw authoredError('Invalid bounded source patch.')
  }
  const { file, beforeRevision, afterRevision, patch } = plan
  return { file, beforeRevision, afterRevision, patch }
}

function matchingPrepared(edit, descriptor, values) {
  return edit.prepared?.file === descriptor.file && Object.hasOwn(values, edit.property)
}

function validateCollision(journal, descriptor, values) {
  if (journal.edits.some(edit => matchingPrepared(edit, descriptor, values))) {
    throw conflict('This source and property already have a prepared edit. Resolve it before writing candidate source.')
  }
}

export function guardAuthoredJournalOperation(message, journal) {
  const native = journal.edits.filter(edit => edit.executor === authoredExecutor)
  if (!native.length) return
  if (native.some(edit => edit.sourceState === 'compiled')) throw conflict('Finish the current source verification first.')
  if (['reset', 'resetAll'].includes(message.type)) throw authoredError('Undo authored source edits individually before resetting the journal.')
  if (message.type === 'setPreviewVisibility' && native.some(edit => edit.id === message.id)) {
    throw authoredError('Use candidate Compare to view the original source.')
  }
  const records = message.records ?? [message.record]
  if (Array.isArray(records) && native.some(edit => records.some(record =>
    record && matchingPrepared(record, edit.authoredBinding, edit.authoredValues)))) {
    throw conflict('This source and property already have an authored edit.')
  }
}

export function authoredTransactions({ binding, file, read, atomic, validators, readCatalog }) {
  const transaction = file + '.authored-transaction'
  const forget = async () => {
    await unlink(transaction).catch(absent)
    active.delete(transaction)
  }

  async function recover(journal, force = false) {
    if (!force && (active.get(transaction) ?? 0) > Date.now()) return
    const intent = await read(transaction, null)
    if (!intent) return
    const at = journal.edits.findIndex(edit => edit.id === intent.edit.id)
    const edit = journal.edits[at]
    const committed = intent.kind === 'save'
      ? edit?.sourceState === 'verified' || edit?.sourceState === 'conflict'
      : !edit
    if (committed) {
      await forget()
      return
    }
    let divergent = false
    try {
      await requireWritableCandidate(binding)
      const current = revision((await source(binding.source, intent.patch.file)).text)
      if (current === intent.patch.afterRevision) await replaceSource(binding, intent.patch, false)
      else if (current !== intent.patch.beforeRevision) {
        const rebased = reverseAuthoredUse(binding.source, { ...intent.patch, ...intent.locators })
        await replaceSource(binding, validReceipt(rebased), true)
      }
    } catch {
      divergent = true
    }
    if (divergent) {
      const unresolved = { ...intent.edit, sourceState: 'conflict' }
      if (at < 0) journal.edits.push(unresolved)
      else journal.edits[at] = unresolved
    } else if (intent.kind === 'save' && at >= 0) journal.edits.splice(at, 1)
    if (at >= 0 || divergent) {
      journal.revision++
      await atomic(file, journal)
    }
    await forget()
    if (force && divergent) throw conflict('Candidate source changed during rollback. Existing source was kept.')
  }

  async function save(message, journal) {
    if (await read(transaction, null)) throw conflict('Finish the current source verification first.')
    await requireWritableCandidate(binding)
    const { record, binding: descriptor, values } = message
    if (!operationId(record?.id) || journal.edits.some(edit => edit.id === record.id) ||
        !descriptor || !values || record.requested !== values[record.property] || record.template ||
        record.prepared || record.pendingColor) throw authoredError('Invalid authored source operation.')
    const latest = latestAuthoredEdits(journal)
    for (const prior of latest.values()) if (prior.authoredBinding.file === descriptor.file) checkAuthoredReceipt(binding, prior)
    const previous = latest.get(descriptor.id)
    if (previous && previous.authoredBinding.revision !== descriptor.revision) {
      throw conflict('The controlling source changed since the previous authored edit.')
    }
    const catalog = record.colorToken ? await readCatalog('colors') : null
    const validated = validators.editFrom({ ...record, restore: 'unique' }, catalog)
    const plan = checkPlan(() => planAuthoredUse(binding.source, descriptor, values))
    const effective = plan.values ?? values
    validateCollision(journal, descriptor, effective)
    const authoredBefore = message.authoredBefore ?? record.authoredBefore
    if (!authoredBefore || Object.keys(authoredBefore).length !== Object.keys(effective).length ||
        Object.keys(effective).some(property => {
          const value = authoredBefore[property]
          return !(property === 'gap' && value === 'normal') && !validValue(property, value)
        })) throw authoredError('Expected the rendered values before writing source.')
    const receipt = { id: validated.id, ...validReceipt(plan) }
    if (receipt.beforeRevision === receipt.afterRevision) return authoredResult(journal)
    const edit = { ...validated, executor: authoredExecutor, sourceState: 'compiled',
      authoredBinding: plan.nextBinding, authoredValues: effective, authoredBefore, sourceReceipt: receipt, authoredBasis: binding.authoredUse.basis,
      authoredPreviousBinding: plan.binding }
    await compile(binding, plan.binding, receipt.beforeRevision)
    const intent = { kind: 'save', edit, patch: receipt,
      locators: { binding: plan.binding, nextBinding: plan.nextBinding } }
    await atomic(transaction, intent)
    active.set(transaction, Date.now() + 15_000)
    let wrote = false
    try {
      await replaceSource(binding, receipt, true)
      wrote = true
      await compile(binding, plan.nextBinding, receipt.afterRevision, true)
      journal.edits.push(edit)
      journal.revision++
      await atomic(file, journal)
    } catch (error) {
      if (wrote) await recover(journal, true)
      else await forget()
      throw error
    }
    return authoredResult(journal, edit)
  }

  async function verify(message, journal, edit) {
    const intent = await read(transaction, null)
    if (intent?.kind !== 'save' || intent.edit.id !== edit.id || edit.sourceState !== 'compiled') {
      throw conflict('The candidate source operation is no longer awaiting verification.')
    }
    let authoredEvidence
    try {
      authoredEvidence = verifyObservation(edit, message.observed, message.evidence)
      await requireWritableCandidate(binding)
      if (revision((await source(binding.source, intent.patch.file)).text) !== intent.patch.afterRevision) {
        throw conflict('Candidate source changed before visible verification.')
      }
      checkPlan(() => reverseAuthoredUse(binding.source, { ...intent.patch, ...intent.locators }))
    } catch (error) {
      await recover(journal, true)
      throw error
    }
    const checked = { ...edit, sourceState: 'verified', authoredObserved: message.observed, authoredEvidence }
    const at = journal.edits.indexOf(edit)
    const next = { ...journal, revision: journal.revision + 1, edits: journal.edits.with(at, checked) }
    try {
      await atomic(file, next)
    } catch (error) {
      await recover(journal, true)
      throw error
    }
    await forget()
    return authoredResult(next, checked)
  }

  async function undo(journal, edit) {
    if (await read(transaction, null)) throw conflict('Finish the current source verification first.')
    await requireWritableCandidate(binding)
    if (journal.edits.slice(journal.edits.indexOf(edit) + 1).some(next => next.authoredBinding?.id === edit.authoredBinding.id)) {
      throw conflict('Undo the newer edit on this authored use first.')
    }
    const context = { ...edit.sourceReceipt, binding: edit.authoredPreviousBinding, nextBinding: edit.authoredBinding }
    const plan = checkPlan(() => reverseAuthoredUse(binding.source, context))
    const patch = validReceipt(plan)
    await atomic(transaction, { kind: 'undo', edit, patch,
      locators: { binding: plan.binding, nextBinding: plan.nextBinding } })
    active.set(transaction, Date.now() + 15_000)
    const next = { ...journal, revision: journal.revision + 1, edits: journal.edits.filter(entry => entry !== edit) }
    let wrote = false
    try {
      await replaceSource(binding, patch, true)
      wrote = true
      await compile(binding, plan.nextBinding, patch.afterRevision, true)
      await atomic(file, next)
    } catch (error) {
      if (wrote) await recover(journal, true)
      else await forget()
      throw error
    }
    await forget()
    return authoredResult(next)
  }

  return {
    recover,
    async reportConflicts(journal) {
      const latest = latestAuthoredEdits(journal)
      for (const edit of latest.values()) {
        if (edit.sourceState === 'verified') {
          try { checkAuthoredReceipt(binding, edit) }
          catch { journal.edits[journal.edits.indexOf(edit)] = { ...edit, sourceState: 'conflict' } }
        }
      }
    },
    async handle(message, journal) {
      const edit = journal.edits.find(entry => entry.executor === authoredExecutor && entry.id === message.id)
      if (message.type === 'saveAuthoredUse') return save(message, journal)
      if (message.type === 'verifyAuthoredUse' || message.type === 'rejectAuthoredUse') {
        if (!edit && message.type === 'rejectAuthoredUse') return authoredResult(journal)
        if (!edit) throw conflict('The authored source operation was not found.')
        if (message.type === 'verifyAuthoredUse') return verify(message, journal, edit)
        if (edit.sourceState !== 'compiled') throw conflict('The candidate source operation is no longer awaiting verification.')
        await recover(journal, true)
        return authoredResult(journal)
      }
      if (edit && ['undo', 'removeEdit'].includes(message.type)) return undo(journal, edit)
    },
  }
}

function checkPlan(plan) {
  try { return plan() }
  catch (error) { throw conflict(error.message) }
}

function latestAuthoredEdits(journal) {
  const latest = new Map()
  for (const edit of journal.edits) if (edit.executor === authoredExecutor) latest.set(edit.authoredBinding.id, edit)
  return latest
}

function checkAuthoredReceipt(binding, edit) {
  if (edit.sourceState !== 'verified' || edit.authoredBasis !== binding.authoredUse?.basis) {
    throw conflict('The candidate still has an unverified or conflicted source edit.')
  }
  checkPlan(() => reverseAuthoredUse(binding.source, { ...edit.sourceReceipt,
    binding: edit.authoredPreviousBinding, nextBinding: edit.authoredBinding }))
}

export async function assertAuthoredReady(binding, file, journal, read) {
  if (await read(file + '.authored-transaction', null)) throw conflict('Finish or recover the interrupted source operation first.')
  for (const edit of latestAuthoredEdits(journal).values()) checkAuthoredReceipt(binding, edit)
}
