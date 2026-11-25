// Fork an immutable operation snapshot into a newly bound, unused proposal.
// Exclusive publication makes a retry safe and never replaces a live journal.
import { randomUUID } from 'node:crypto'
import { readFile, writeFile, link, unlink, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { readProposal } from './proposal.mjs'
import { helperResult } from './proposal-journal.mjs'

export async function forkableEdits(state, parent, revision) {
  const original = await readFile(join(state, parent.project.id + '-changes.json'), 'utf8')
    .then(JSON.parse)
    .catch((e) => {
      if (e.code !== 'ENOENT') throw e
      return { revision: 0, edits: [] }
    })
  if (original.revision !== revision) throw Error('Parent edits changed. Retry from the current revision.')
  const edits = original.edits.filter((e) => !e.undone && !e.previewHidden)
  if (edits.some((e) => !e.prepared) || original.textStyleDefinitions?.length)
    throw Error(
      'Integrate or hide occurrence-only edits and complete pending style definitions before forking this preview.',
    )
  return edits
}

export async function forkPrepared(state, parentPort, childPort, proposal, revision) {
  const parent = helperResult(state, 'handoff', String(parentPort))
  const child = helperResult(state, 'handoff', String(childPort))
  const draft = readProposal(proposal)
  if (
    parent.revision !== revision ||
    child.revision ||
    parent.project.id === child.project.id ||
    draft.sourceRoot !== parent.project.source ||
    child.project.source !== (await realpath(join(proposal, 'app')))
  ) {
    throw Error('The source or destination changed during branching.')
  }
  const edits = await forkableEdits(state, parent, revision)
  const snapshot = {
    version: 2,
    revision: edits.length ? 1 : 0,
    binding: child.project,
    edits,
    forkedFrom: { projectId: parent.project.id, revision, basis: draft.basis },
  }
  const dest = join(state, child.project.id + '-changes.json'),
    tmp = dest + '.' + randomUUID()
  await writeFile(tmp, JSON.stringify(snapshot), { flag: 'wx', mode: 0o600 })
  try {
    await link(tmp, dest)
  } finally {
    await unlink(tmp)
  }
  return snapshot.forkedFrom
}
