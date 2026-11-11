import { cp, mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { injectedFiles, project } from './check-modules.mjs'

await injectedFiles()
const manifest = JSON.parse(await readFile(join(project, 'extension/manifest.json'), 'utf8'))
if (manifest.manifest_version !== 3) throw Error('Expected a Manifest V3 extension')
const destination = join(project, 'dist/extension')
await mkdir(join(project, 'dist'), { recursive: true })
await rm(destination, { recursive: true, force: true })
await cp(join(project, 'extension'), destination, { recursive: true })
console.log('Unpacked extension built at ' + destination)
