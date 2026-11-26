// Build a separate Inspector copy using the app's own Vite config and dependencies.
import { createRequire } from 'node:module'
import { mkdir, realpath } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { componentPreviewSites } from './component-preview-sites.mjs'
import { tableRenderSites } from './table-render-sites.mjs'

const [project, destination, configFile] = process.argv.slice(2)
if (!project || !destination) throw Error('Usage: node scripts/flow/build-table-preview.mjs APP_ROOT NEW_OUTPUT_DIRECTORY')
const root = await realpath(project)
const output = resolve(destination)
const outDir = join(await realpath(dirname(output)), basename(output))
if (outDir === root || outDir.startsWith(root + sep)) throw Error('Choose a new preview directory outside the app repository.')
const requireFromApp = createRequire(join(root, 'package.json'))
const { build } = await import(pathToFileURL(requireFromApp.resolve('vite')))
await mkdir(outDir) // Refuse to overwrite the app build or a previous preview.
process.chdir(root)
await build({ root, configFile: configFile && resolve(root, configFile), plugins: [tableRenderSites(root), componentPreviewSites(root)], build: { outDir, emptyOutDir: false } })
