// Copy authored records into a portable snapshot without machine-specific bindings.
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const [state, port, destination] = process.argv.slice(2)
if (!state || !/^\d+$/.test(port) || !destination) {
  throw Error('Usage: canvas-inspector-state.mjs HELPER_STATE PORT OUTPUT_JSON')
}
const json = async file => JSON.parse(await readFile(join(state, file), 'utf8'))
const origin = 'http://127.0.0.1:' + port
const binding = (await json('bindings.json'))[origin]
if (!binding || binding.origin !== origin || !/^[a-f\d-]{36}$/i.test(binding.id)) throw Error('Unknown project binding')
const optional = file => json(file).catch(error => {
  if (error.code !== 'ENOENT') throw error
})
const journal = await optional(binding.id + '-changes.json')
if (journal && (journal.version !== 2 || journal.binding?.id !== binding.id ||
  journal.binding?.source !== binding.source || journal.binding?.origin !== origin || !Array.isArray(journal.edits))) {
  throw Error('Cannot export an incompatible edit journal')
}
const registrations = {}
for (const kind of ['colors', 'spacing', 'font-families', 'text-styles', 'button-size']) {
  const registration = await optional(binding.id + '-' + kind + '.json')
  if (registration) registrations[kind] = registration
}
const snapshot = { version: 1, revision: journal?.revision ?? 0, edits: journal?.edits ?? [],
  textStyleDefinitions: journal?.textStyleDefinitions ?? [], registrations }
await writeFile(destination, JSON.stringify(snapshot, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
