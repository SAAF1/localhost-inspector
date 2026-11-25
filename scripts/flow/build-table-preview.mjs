// Build a separate Inspector copy using the app's own Vite config and dependencies.
import { projectVite } from './project-vite.mjs'
import { mkdir, realpath } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { componentPreviewSites } from './component-preview-sites.mjs'
import { tableRenderSites } from './table-render-sites.mjs'

const [project, destination] = process.argv.slice(2)
if (!project || !destination) throw Error('Usage: node scripts/flow/build-table-preview.mjs APP_ROOT NEW_OUTPUT_DIRECTORY')
const root = await realpath(project)
const output = resolve(destination)
const outDir = join(await realpath(dirname(output)), basename(output))
if (outDir === root || outDir.startsWith(root + sep)) throw Error('Choose a new preview directory outside the app repository.')
const { build } = await projectVite(root)
await mkdir(outDir) // Refuse to overwrite the app build or a previous preview.
process.chdir(root)
await build({ root, plugins: [tableRenderSites(root), componentPreviewSites(root)], build: { outDir, emptyOutDir: false } })
