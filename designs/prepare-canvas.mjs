import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const relative = path => fileURLToPath(new URL(path, import.meta.url))
const staging = await mkdtemp(join(tmpdir(), 'inspector-study-'))
try {
  const build = join(staging, 'preview')
  execFileSync(process.execPath, [relative('../scripts/flow/build-table-preview.mjs'), relative('./shadcn-admin/'), build], { stdio: 'inherit' })
  const variants = relative('./canvas/variants/')
  for (const owner of await readdir(variants, { withFileTypes: true })) {
    if (!owner.isDirectory()) continue
    const directory = join(variants, owner.name)
    const frame = JSON.parse(await readFile(join(directory, 'frame.json'), 'utf8'))
    for (const step of frame.steps ?? []) await mkdir(join(directory, 'steps', step.key), { recursive: true })
    await cp(build, join(directory, 'preview'), { recursive: true })
  }
} finally {
  await rm(staging, { recursive: true, force: true })
}
