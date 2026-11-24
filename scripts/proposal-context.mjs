import { resolveProposalFrame } from './flow/proposal-view.mjs'
import { createHash } from 'node:crypto'

const workspace = '/__inspector-flow/'
const fingerprint = frame => createHash('sha256').update(JSON.stringify([
  frame.route, frame.steps || [], frame.checkpoint || [],
])).digest('hex')

export function proposalContext(map, activeUrl, saved) {
  const original = new URL(map.origin)
  const frames = map.frames
  if (!activeUrl && !saved) return {}
  // Frame numbers are assigned by discovery and may change when a map is rebuilt.
  if (!activeUrl) {
    const matches = frames.filter(frame => fingerprint(frame) === saved.scenario)
    if (matches.length !== 1) throw Error('The saved scenario changed. Open the intended screen and supply its workspace URL.')
    return { ...saved, frame: matches[0].id }
  }
  const active = new URL(activeUrl, original)
  if (active.origin !== original.origin) throw Error('The selected page belongs to another app.')
  const params = active.pathname === workspace
    ? (active.hash.startsWith('#context=1&') ? new URLSearchParams(active.hash.slice(1)) : active.searchParams)
    : new URLSearchParams({ page: active.pathname + active.search + active.hash })
  const page = params.get('page')
  const frameId = params.get('frame')
  if (!page && !frameId) return {}
  const route = page && new URL(page, original)
  if (route && (!page.startsWith('/') || route.origin !== original.origin)) throw Error('Expected a page inside the original app.')
  const frame = resolveProposalFrame(frames, frameId, page, original.origin)
  if (!frame) throw Error('Open a mapped screen before starting this proposal.')
  return { scenario: fingerprint(frame), frame: frame.id, page: page || frame.route, expanded: params.get('view') === 'canvas' }
}

export function reviewUrl(origin, context) {
  const url = new URL(workspace, origin)
  if (context.frame) {
    const params = new URLSearchParams({ context: '1', frame: context.frame, page: context.page })
    if (context.expanded) params.set('view', 'canvas')
    url.hash = params.toString()
  }
  return url.href
}
