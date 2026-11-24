import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const helper = fileURLToPath(new URL('../local-helper.mjs', import.meta.url))
const json = path => JSON.parse(readFileSync(path, 'utf8'))
export const sessionFile = directory => join(directory, 'preview-session.json')
export const helperResult = (state, ...args) => JSON.parse(execFileSync(process.execPath, [helper, state, ...args], {
  encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
}))

export function candidateHandoff(directory) {
  const session = json(sessionFile(directory))
  const handoff = helperResult(session.state, 'handoff', session.port)
  if (handoff.project.id !== session.binding || handoff.project.source !== realpathSync(join(directory, 'app'))) {
    throw Error('This journal belongs to a different proposal.')
  }
  return handoff
}

export function checkAcceptance(directory) {
  if (!existsSync(sessionFile(directory))) return
  const handoff = candidateHandoff(directory)
  if (handoff.operations.length || handoff.textStyleDefinitions?.length) {
    throw Error('Inspector refinements are still pending. Use the proposal handoff to implement and verify them in the candidate before accepting.')
  }
}

export function checkRefresh(directory) {
  if (!existsSync(sessionFile(directory))) return
  const session = json(sessionFile(directory))
  const { pending } = helperResult(session.state, 'proposal-readiness', session.port, session.binding, join(directory, 'app'))
  if (pending) throw Error('Inspector edits are still pending. Apply and verify the refinements in this proposal before refreshing.')
  return session.context
}
