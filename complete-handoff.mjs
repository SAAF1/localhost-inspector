import { buildSourceHandoff } from './source-handoff.mjs'

export function completeHandoff(binding, journal, report, completedAt) {
  const { projectId, verified } = report ?? {}
  if (projectId !== binding.id || !Array.isArray(verified) || verified.length === 0 || verified.length > 20) {
    throw Error('Expected a verified operation list for this project')
  }
  const pending = new Map(buildSourceHandoff(binding, journal).operations
    .filter(operation => operation.status === 'pending').map(operation => [operation.id, operation]))
  const completed = []
  const retired = new Set()
  for (const { id, summary } of verified.map(item => item ?? {})) {
    const operation = pending.get(id)
    if (!operation || typeof summary !== 'string' || !summary.trim() || summary.length > 800) {
      throw Error('Each completion must name a distinct pending operation and include a verification summary')
    }
    pending.delete(id)
    completed.push({ id, summary: summary.trim(), completedAt })
    for (const change of operation.changes) retired.add(change.id)
  }

  journal.edits = journal.edits.filter(edit => !retired.has(edit.id))
  journal.completed = [...(journal.completed ?? []), ...completed]
  return { completed, retired: [...retired] }
}
