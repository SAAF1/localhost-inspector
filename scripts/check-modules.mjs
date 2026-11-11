import { access, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const project = fileURLToPath(new URL('../', import.meta.url))
export async function injectedFiles() {
  const worker = await readFile(join(project, 'extension/worker.js'), 'utf8')
  const files = worker.match(/files:\s*\[([^\]]+)\]/)?.[1].match(/'([^']+)'/g)?.map(value => value.slice(1, -1))
  if (!files?.length) throw Error('Missing extension injection entrypoint')
  if (new Set(files).size !== files.length) throw Error('Duplicate injection module')
  for (const file of files) {
    const path = resolve(project, 'extension', file)
    if (!path.startsWith(join(project, 'extension') + '/')) throw Error('Module escapes extension: ' + file)
    await access(path)
  }
  return files
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log('Verified ' + (await injectedFiles()).length + ' extension injection modules')
}
