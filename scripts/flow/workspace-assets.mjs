import { readFile } from 'node:fs/promises'
import { inspectorModules } from '../../extension/inspector-modules.js'
import { flowPath } from '../../extension/flow-attachment.js'

const assets = new Map([
  ['', ['workspace.html', 'text/html']],
  ['variant-editor.html', ['variant-editor.html', 'text/html']],
  ['inspector-request.mjs', ['inspector-request.mjs', 'text/javascript']],
  ['variant-editor.mjs', ['variant-editor.mjs', 'text/javascript']],
  ['inter-latin.woff2', ['../../extension/assets/inter-latin.woff2', 'font/woff2']],
  ['component-preview.js', ['../../extension/component-preview.js', 'text/javascript']],
  ['workspace.css', ['workspace.css', 'text/css']],
  ['proposal-link.mjs', ['proposal-link.mjs', 'text/javascript']],
  ['variant-overview.mjs', ['variant-overview.mjs', 'text/javascript']],
  ['variant-window.mjs', ['variant-window.mjs', 'text/javascript']],
  ['variant-warmup.mjs', ['variant-warmup.mjs', 'text/javascript']],
  ['proposal-view.mjs', ['proposal-view.mjs', 'text/javascript']],
  ['preview-wheel.mjs', ['preview-wheel.mjs', 'text/javascript']],
  ['linked-frame.html', ['linked-frame.html', 'text/html']],
  ['linked-frame.mjs', ['linked-frame.mjs', 'text/javascript']],
  ...['variant-inspection.mjs', 'variant-layers.mjs', 'variant-layers.html', 'variant-panels.mjs', 'variant-editor-docks.mjs'].map(name =>
    [name, [name, name.endsWith('.html') ? 'text/html' : 'text/javascript']]),
  ['workspace-editor.mjs', ['workspace-editor.mjs', 'text/javascript']],
  ['variant-sections.mjs', ['variant-sections.mjs', 'text/javascript']],
  ['workspace.mjs', ['workspace.mjs', 'text/javascript']],
  ...['tokens', 'styles', 'panel-styles', 'icons', 'tooltip', 'dom', 'menu', 'variables-panel',
    'variables-typography', 'variables-styles', 'authored-styles', 'policy', 'text-style-values', 'color-bindings', 'solid-color-picker', 'spacing-gap'].map(
    name => [name + '.js', ['../../extension/ui/' + name + '.js', 'text/javascript']]),
  ['variables-audit.js', ['../../extension/variables-audit.js', 'text/javascript']],
  ['color-preview.mjs', ['color-preview.mjs', 'text/javascript']],
  ['spacing-preview.mjs', ['spacing-preview.mjs', 'text/javascript']],
  ['workspace-activity.mjs', ['workspace-activity.mjs', 'text/javascript']],
  ['inventory-ui.mjs', ['inventory-ui.mjs', 'text/javascript']],
  ['workspace-sidebar.mjs', ['workspace-sidebar.mjs', 'text/javascript']],
  ['workspace-layers.mjs', ['workspace-layers.mjs', 'text/javascript']],
  ['workspace-layer-flows.mjs', ['workspace-layer-flows.mjs', 'text/javascript']],
  ['workspace-layer-hover.mjs', ['workspace-layer-hover.mjs', 'text/javascript']],
  ['workspace-layer-row.mjs', ['workspace-layer-row.mjs', 'text/javascript']],
  ['workspace-layer-details.mjs', ['workspace-layer-details.mjs', 'text/javascript']],
  ['workspace-layers.css', ['workspace-layers.css', 'text/css']],
  ['sidebar.css', ['sidebar.css', 'text/css']],
  ['view-controls.mjs', ['view-controls.mjs', 'text/javascript']],
  ['frame-view.mjs', ['frame-view.mjs', 'text/javascript']],
  ['sharp-previews.mjs', ['sharp-previews.mjs', 'text/javascript']],
  ['render-frames.mjs', ['render-frames.mjs', 'text/javascript']],
  ['replay.mjs', ['replay.mjs', 'text/javascript']],
  ['page-state.mjs', ['page-state.mjs', 'text/javascript']],
])

// Serve one Inspector version for the lifetime of this process. Reading a new
// client on every request can mix it with an older server's asset registry.
const workspaceFiles = new Map(await Promise.all([...assets].map(async ([name, [file, type]]) =>
  [name, { type, data: await readFile(new URL(file, import.meta.url)) }])))
const runtimeParts = await Promise.all(inspectorModules.filter(file => file !== 'bridge.js').map(file =>
  readFile(new URL('../../extension/' + file, import.meta.url), 'utf8')))
workspaceFiles.set('variant-runtime.mjs', { type: 'text/javascript', data: runtimeParts.join('\n;\n') })

export function serveWorkspaceAsset(path, response, canvasEditor = false) {
  if (!path.startsWith(flowPath)) return false
  const asset = workspaceFiles.get(path.slice(flowPath.length))
  if (!asset) return false
  response.writeHead(200, { 'content-type': asset.type + '; charset=utf-8', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff' }).end(canvasEditor && path === flowPath ? asset.data.toString().replace('<body>', '<body data-canvas-editor>') : asset.data)
  return true
}

const previewAssets = new Set(['inventory-ui.mjs', 'panel-styles.js', 'menu.js', 'variables-styles.js', 'variables-typography.js',
  'variables-panel.js', 'policy.js', 'authored-styles.js', 'text-style-values.js', 'color-bindings.js', 'solid-color-picker.js',
  'spacing-gap.js', 'variables-audit.js', 'sidebar.css', 'color-preview.mjs', 'spacing-preview.mjs', 'inspector-request.mjs', 'variant-editor.html', 'variant-editor.mjs', 'variant-runtime.mjs', 'component-preview.js',
  'inter-latin.woff2', 'preview-wheel.mjs', 'variant-inspection.mjs', 'variant-layers.mjs',
  'variant-layers.html', 'workspace-layers.mjs', 'workspace-layer-row.mjs', 'workspace-layer-hover.mjs', 'workspace-layer-flows.mjs', 'workspace-layer-details.mjs', 'workspace-layers.css', 'tokens.js', 'styles.js',
  'icons.js', 'dom.js', 'tooltip.js'].map(name => flowPath + name))

export function servePreviewAsset(path, response) {
  return previewAssets.has(path) && serveWorkspaceAsset(path, response)
}
