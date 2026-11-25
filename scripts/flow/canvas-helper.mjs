// Only an explicitly paired launcher can give this canvas access to its original
// project's journal. Never forward a client-provided origin or helper command.
import { helperHost } from '../../helper-port.mjs'
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const allowed = new Set(('load check colorCatalog spacingCatalog textStyleCatalog fontFamilyCatalog variablesCatalog ' +
  'save saveTextStyleDefinition saveButtonSize saveComponentProperty saveSharedPadding savePairedPadding saveSelectionPaint ' +
  'saveTextStyle setPreviewVisibility removeEdit undo reset resetAll').split(' '))

export async function canvasHelper(canvas, project, origin, configured) {
  const marker = join(canvas, 'paired-helper.local.json')
  const optional = path => readFile(path, 'utf8').then(JSON.parse).catch(error => {
    if (error.code !== 'ENOENT') throw error
  })
  const reference = await optional(marker)
  if (!reference && !configured) return null
  const state = await realpath(configured || reference.state)
  const binding = (await optional(join(state, 'bindings.json')))?.[origin]
  if (!binding || binding.source !== await realpath(project) || binding.origin !== origin ||
      !/^[a-f0-9-]{36}$/i.test(binding.id) || (reference && (reference.id !== binding.id || reference.state !== state))) {
    throw Error('Canvas helper binding changed. Check the paired project and its original port.')
  }
  if (!reference) {
    const seed = await optional(join(canvas, 'inspector-state.json'))
    if (seed && (seed.edits?.length || seed.textStyleDefinitions?.length)) {
      const live = await optional(join(state, binding.id + '-changes.json'))
      if (!live || seed.revision !== live.revision || JSON.stringify(seed.edits) !== JSON.stringify(live.edits) ||
          JSON.stringify(seed.textStyleDefinitions ?? []) !== JSON.stringify(live.textStyleDefinitions ?? [])) {
        throw Error('The saved canvas and paired helper have different edits. Reconcile their histories before connecting.')
      }
    }
    // Never silently replace an independent standalone history.
    const standalone = await readFile(join(canvas, 'edits.sqlite')).catch(error => { if (error.code !== 'ENOENT') throw error })
    if (standalone) throw Error('This canvas already has standalone edits. Reconcile them before connecting another journal.')
    await writeFile(marker, JSON.stringify({state, id: binding.id, origin}), {flag:'wx', mode:0o600})
  }
  return {
    async handle(message) {
      if (message.type === 'ping') return true
      if (!allowed.has(message.type)) throw Error('Unsupported canvas operation')
      const key = (await readFile(join(state, 'pairing-key'), 'utf8')).trim()
      const response = await fetch('http://' + helperHost + '/inspector', {
        method: 'POST', redirect: 'error', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
        body: JSON.stringify({ ...message, origin, expectedBindingId: binding.id }), signal: AbortSignal.timeout(5000),
      }).catch(() => { throw Error('The paired Inspector helper is offline. Restart it and reload to edit.') })
      const result = await response.json()
      if (!response.ok) throw Object.assign(Error(result.error || 'The paired Inspector rejected this change'), {code:result.code})
      if (result.value && typeof result.value === 'object') {
        delete result.value.file
        // Screen captures need the extension; this client can only save edits.
        delete result.value.visualEvidence
      }
      return result.value
    },
  }
}
