import { buildSourceHandoff, sourceWinners } from './source-handoff.mjs'

export function completeHandoff(binding, journal, report, completedAt) {
  const { projectId, verified } = report ?? {}
  if (projectId !== binding.id || !Array.isArray(verified) || verified.length === 0 || verified.length > 20) {
    throw Error('Expected a verified operation list for this project')
  }
  const pending = new Map(buildSourceHandoff(binding, journal).operations
    .filter(operation => operation.status === 'pending').map(operation => [operation.id, operation]))
  const completed = []
  for (const { id, summary } of verified.map(item => item ?? {})) {
    const operation = pending.get(id)
    if (!operation || typeof summary !== 'string' || !summary.trim() || summary.length > 800) {
      throw Error('Each completion must name a distinct pending operation and include a verification summary')
    }
    pending.delete(id)
    completed.push({ id, summary: summary.trim(), completedAt })
  }

  // A handoff can show only the edits needed to describe one source change.
  // Completion must also retire its preview-only journal members.
  const completedIds = new Set(completed.map(entry => entry.id))
  const winners = sourceWinners(journal)
  const retired = new Set(journal.edits.filter(edit =>
    !edit.undone && completedIds.has(winners.get(edit.id)?.operation ?? edit.group ?? edit.id),
  ).map(edit => edit.id))
  const retiredStyles = new Set(journal.edits.flatMap(edit =>
    retired.has(edit.id) && edit.pendingTextStyle ? [edit.pendingTextStyle.name] : []))
  const remaining = journal.edits.filter(edit => !retired.has(edit.id))
  const dependent = remaining.find(edit => !edit.undone && retiredStyles.has(edit.pendingTextStyleName))
  if (dependent) {
    throw Error('Pending edits still use ' + dependent.pendingTextStyleName +
      '. Verify and complete those applications first or include them in the same report.')
  }

  if (journal.preparedRevisions) for (const id of retired) delete journal.preparedRevisions[id]
  journal.edits = remaining
  journal.completed = [...(journal.completed ?? []), ...completed]
  return { completed, retired: [...retired] }
}
