import { spawn } from 'node:child_process'
import { createProposal, readProposal } from './proposal.mjs'
import { proposalContext, reviewUrl } from './proposal-context.mjs'
import { once } from 'node:events'
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { link, rename, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { candidateHandoff, helperResult, sessionFile } from './proposal-journal.mjs'

export { candidateHandoff, checkAcceptance, checkRefresh } from './proposal-journal.mjs'

const json = path => JSON.parse(readFileSync(path, 'utf8'))
const host = fileURLToPath(new URL('flow/serve.mjs', import.meta.url))

async function start(directory, mapDirectory, stateDirectory, port, activeUrl) {
  if (!/^\d+$/.test(port) || +port < 1024 || +port > 65535 || +port === 5188) throw Error('Choose an available development port.')
  const state = realpathSync(stateDirectory)
  const mapRoot = realpathSync(mapDirectory)
  const map = json(join(mapRoot, 'map.json'))
  const original = new URL(map.origin)
  if (original.protocol !== 'http:' || original.hostname !== '127.0.0.1' || !original.port || original.port === port) {
    throw Error('Expected a mapped loopback app and a separate proposal port.')
  }
  const saved = existsSync(sessionFile(directory)) && json(sessionFile(directory))
  if (saved && (saved.port !== port || saved.state !== state)) throw Error('Reopen using the original journal directory and proposal port.')
  const basis = helperResult(state, 'handoff', original.port)
  const metadata = join(directory, 'proposal.json')
  const proposal = existsSync(metadata) ? readProposal(directory) : createProposal(basis.project.source, directory)
  if (proposal.sourceRoot !== basis.project.source || proposal.status === 'accepted') throw Error('Expected an open proposal from this app.')
  const source = realpathSync(join(directory, 'app'))
  const retained = saved?.context ?? proposal.context
  const entry = activeUrl || (!retained && map.frames.find(frame => !frame.steps?.length)?.route)
  const context = proposalContext(map, entry, retained)
  const origin = 'http://127.0.0.1:' + port
  const workspace = reviewUrl(original.origin, { ...context, expanded: true })
  const server = spawn(process.execPath, [host, '--source', source, port, mapRoot, '--original-port', original.port], {
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  const exit = once(server, 'exit')
  let stopping = false
  const stop = () => {
    stopping = true
    server.kill()
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
  const linkPath = join(mapRoot, 'proposal-preview.json')
  const linkData = JSON.stringify({ originalOrigin: original.origin, proposalOrigin: origin, context })
  let linked = false
  try {
    let readyText = ''
    const ready = new Promise(resolveReady => server.stdout.on('data', chunk => {
      readyText = (readyText + chunk).slice(-8192)
      if (readyText.includes('Inspector project preview listening on ' + port)) resolveReady()
    }))
    await Promise.race([ready, exit.then(() => { throw Error('Proposal server stopped before startup.') })])
    const binding = helperResult(state, 'bind', port, source)
    if (saved && binding.id !== saved.binding) throw Error('The original proposal journal is unavailable.')
    const { skipped } = saved ? { skipped: [] } : helperResult(state, 'copy-registrations', original.port, port)
    const temp = linkPath + '.' + randomUUID()
    await writeFile(temp, linkData, { flag: 'wx', mode: 0o600 })
    try {
      await link(temp, linkPath)
    } catch (error) {
      if (error.code !== 'EEXIST' || readFileSync(linkPath, 'utf8') !== linkData) throw Error('Another proposal is already linked to this canvas.', { cause: error })
    } finally {
      await unlink(temp)
    }
    linked = true
    const registrationWarnings = saved?.skippedRegistrations ?? skipped
    const record = { state, port, binding: binding.id, context: context.frame ? context : undefined,
      skippedRegistrations: registrationWarnings }
    if (!saved) writeFileSync(sessionFile(directory), JSON.stringify(record), { flag: 'wx', mode: 0o600 })
    else if (context.frame && (activeUrl || saved.context?.frame !== context.frame)) {
      const replacement = sessionFile(directory) + '.' + randomUUID()
      await writeFile(replacement, JSON.stringify(record), { flag: 'wx', mode: 0o600 })
      await rename(replacement, sessionFile(directory))
    }
    console.log(JSON.stringify({ workspace, candidateWorkspace: reviewUrl(origin, context), skippedRegistrations: registrationWarnings, candidateSource: source, originalSource: basis.project.source,
      originalPendingOperations: basis.operations.length, originalPendingStyles: basis.textStyleDefinitions?.length ?? 0 }))
    const [code, signal] = await exit
    if (!stopping && code !== 0 && !['SIGINT', 'SIGTERM'].includes(signal)) throw Error('Proposal server stopped unexpectedly.')
  } finally {
    stop()
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
    if (linked && existsSync(linkPath) && readFileSync(linkPath, 'utf8') === linkData) await unlink(linkPath)
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [action, directory, ...args] = process.argv.slice(2)
  if (action === 'start' && directory && args.length >= 3 && args.length <= 4) await start(resolve(directory), ...args)
  else if (action === 'handoff' && directory && !args.length) console.log(JSON.stringify(candidateHandoff(resolve(directory)), null, 2))
  else throw Error('Usage: preview-session.mjs start PROPOSAL MAP_DIRECTORY HELPER_STATE PORT [ACTIVE_URL] | handoff PROPOSAL')
}
