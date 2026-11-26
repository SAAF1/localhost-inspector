import { join } from 'node:path'
import { effectivePreparedEdit } from './journal-edits.mjs'
import { conflict } from './authored-source-file.mjs'
import { parseAuthoredJsx } from './scripts/flow/authored-forwarding.mjs'
import { matchesPreparedOpening, preparedOpenings, preparedRevision, preparedStyleTargets } from './scripts/flow/prepared-site-qualification.mjs'

function uniqueStyleUse(site, code, openings) {
  const matches = openings.filter(({ node, owner }) =>
    owner.id.name === site.owner && matchesPreparedOpening(site, code, node))
  if (matches.length !== 1 || (!site.input && !preparedStyleTargets(site, matches[0].node, code)?.length)) {
    throw conflict('A saved shared edit no longer has a unique qualified source use.')
  }
  return matches[0]
}

const operationKey = edit => JSON.stringify([edit.prepared.file, edit.prepared.site, edit.property])
const intersects = (a, b) => a.start < b.end && b.start < a.end

export async function preparedTransitions(binding, journal, plan, read) {
  const prepared = journal.edits.filter(edit => edit.prepared)
  if (!prepared.length) return []
  const manifest = await read(join(binding.authoredUse.directory, 'prepared.json'), null)
  if (!manifest?.namespace || !Array.isArray(manifest.sites)) {
    throw conflict('Prepared source could not be requalified. Reopen the candidate before editing.')
  }
  const active = new Map(prepared.filter(edit => !edit.previewHidden).map(edit => [operationKey(edit), edit.id]))
  const dependencyBytes = new Map()
  const qualifications = new Map()
  const transitions = []
  let syntax
  for (const original of prepared) {
    const edit = effectivePreparedEdit(original, journal)
    const { site: id, file, revision: current } = edit.prepared
    const sites = manifest.sites.filter(site => site.id === id && site.file === file)
    if (sites.some(site => site.dependencies?.includes(plan.file))) {
      throw conflict('The source edit changes a dependency of a saved prepared operation.')
    }
    if (file !== plan.file) continue
    if (sites.length !== 1) {
      throw conflict('A saved prepared operation on this file cannot be safely requalified.')
    }
    const [site] = sites
    if (!site.input && !(site.styles ?? [site.style]).some(style => style?.property === edit.property)) {
      throw conflict('A saved prepared property no longer matches its controlling declaration.')
    }
    if (!qualifications.has(id)) {
      if (!syntax) {
        const before = parseAuthoredJsx(plan.before)
        const after = parseAuthoredJsx(plan.after)
        syntax = { before, after, oldUses: preparedOpenings(before), newUses: preparedOpenings(after) }
      }
      const old = uniqueStyleUse(site, plan.before, syntax.oldUses)
      const next = uniqueStyleUse(site, plan.after, syntax.newUses)
      const patch = { start: plan.patch.start, end: plan.patch.start + Math.max(plan.patch.before.length, 1) }
      if (intersects(old.node, patch) ||
          (plan.binding.family === 'spacing' && intersects(old.element, plan.ownedElement))) {
        throw conflict('The source edit overlaps the controlling use of a saved prepared operation.')
      }
      const from = preparedRevision(binding.source, manifest.namespace, site, plan.before, syntax.before, old.owner, dependencyBytes)
      const to = preparedRevision(binding.source, manifest.namespace, site, plan.after, syntax.after, next.owner, dependencyBytes)
      if (!from || !to) throw conflict('A saved prepared operation no longer has its controlling source dependencies.')
      if (site.input && from !== to) throw conflict('A saved component input on this file cannot be safely requalified.')
      qualifications.set(id, { from, to })
    }
    const { from, to } = qualifications.get(id)
    if (current !== from) throw conflict('The controlling source changed since a prepared operation was saved.')
    if (from !== to) transitions.push({ id: edit.id, site: id, file, from, to, property: edit.property,
      visible: active.get(operationKey(edit)) === edit.id })
  }
  return transitions
}

export function applyPreparedTransitions(journal, transitions = [], direction = 'to') {
  if (!transitions.length) return journal
  const preparedRevisions = { ...journal.preparedRevisions }
  for (const change of transitions) {
    const edit = journal.edits.find(row => row.id === change.id)
    if (!edit?.prepared || edit.prepared.site !== change.site) continue
    if (edit.prepared.revision === change[direction]) delete preparedRevisions[change.id]
    else preparedRevisions[change.id] = change[direction]
  }
  return { ...journal, preparedRevisions }
}

export function requirePreparedTransitions(expected, offered = []) {
  if (!Array.isArray(offered) || offered.length !== expected.length || expected.some((change, index) =>
    !offered[index] || Object.entries(change).some(([field, value]) => offered[index][field] !== value))) {
    throw conflict('Saved prepared edits changed. Reopen the candidate before applying this source change.')
  }
}

export function verifyPreparedEvidence(transitions = [], evidence = []) {
  const expected = transitions.filter(change => change.visible)
  if (!Array.isArray(evidence) || evidence.length !== expected.length || expected.some(change =>
    !evidence.some(record => record?.id === change.id && record.revision === change.to &&
      Number.isSafeInteger(record.visibleMembers) && record.visibleMembers > 0))) {
    throw conflict('Could not verify every retained prepared effect. The source change was restored.')
  }
  return expected.map(change => {
    const { id, revision, visibleMembers } = evidence.find(record => record.id === change.id)
    return { id, revision, visibleMembers }
  })
}
