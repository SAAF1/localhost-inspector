import { readFile } from 'node:fs/promises'
import { flowPath } from '../../extension/flow-attachment.js'

const assets = new Map([
  ['', ['workspace.html', 'text/html']],
  ['workspace.css', ['workspace.css', 'text/css']],
  ['workspace.mjs', ['workspace.mjs', 'text/javascript']],
  ...['tokens', 'styles', 'panel-styles', 'icons', 'tooltip', 'dom', 'menu', 'variables-panel',
    'variables-styles', 'authored-styles', 'policy', 'text-style-values', 'color-bindings', 'solid-color-picker', 'spacing-gap'].map(
    name => [name + '.js', ['../../extension/ui/' + name + '.js', 'text/javascript']]),
  ['variables-audit.js', ['../../extension/variables-audit.js', 'text/javascript']],
  ['workspace-sidebar.mjs', ['workspace-sidebar.mjs', 'text/javascript']],
  ['sidebar.css', ['sidebar.css', 'text/css']],
  ['view-controls.mjs', ['view-controls.mjs', 'text/javascript']],
  ['frame-view.mjs', ['frame-view.mjs', 'text/javascript']],
  ['sharp-previews.mjs', ['sharp-previews.mjs', 'text/javascript']],
  ['render-frames.mjs', ['render-frames.mjs', 'text/javascript']],
  ['replay.mjs', ['replay.mjs', 'text/javascript']],
  ['page-state.mjs', ['page-state.mjs', 'text/javascript']],
])

export async function serveWorkspaceAsset(path, response) {
  if (!path.startsWith(flowPath)) return false
  const asset = assets.get(path.slice(flowPath.length))
  if (!asset) return false
  const [file, type] = asset
  const data = await readFile(new URL(file, import.meta.url))
  response.writeHead(200, { 'content-type': type + '; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff' }).end(data)
  return true
}
