import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { discoverVariablesCatalog } from '../variables-catalog.mjs'

test('partial registration preserves discovery and the registered category’s owner', async t => {
  const root = await mkdtemp(join(tmpdir(), 'variables-catalog-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const spacing = { source: 'layout.css', css: ':root { --space-sm: 4px; }', names: ['--space-sm'] }
  await writeFile(join(root, spacing.source), spacing.css)
  await writeFile(join(root, 'palette.css'), ':root { --color-ink: black; --space-foreign: 7px; }')
  const catalog = await discoverVariablesCatalog(root, { spacingCatalog: spacing })
  assert.deepEqual(catalog.colorCatalog, { names: ['--color-ink'], source: 'palette.css' })
  assert.deepEqual(catalog.spacingCatalog, { names: ['--space-sm'], source: 'layout.css' })
})
