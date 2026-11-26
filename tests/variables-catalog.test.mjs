import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { authoringStyles, discoverVariablesCatalog } from '../variables-catalog.mjs'

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

test('authoring returns the registered styles and the utility that binds the entire recipe', async t => {
  const root = await mkdtemp(join(tmpdir(), 'authoring-styles-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const fields = ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing']
  await writeFile(join(root, 'theme.css'), ':root { --space-small: 8px; --space-extra: 7px; --color-ink: black;' +
    fields.map(field => '--text-body-' + field + ': initial;').join('') + ' }')
  await writeFile(join(root, 'type.css'), '@utility body-copy {' +
    fields.map(field => field + ': var(--text-body-' + field + ');').join('') + '}')
  const styles = await authoringStyles(root, { spacing: { source: 'theme.css', names: ['--space-small'] } })
  assert.deepEqual(styles.spacing[0].tokens, ['--space-small'])
  assert.deepEqual(styles.typography[0].utility, { className: 'body-copy', source: 'type.css' })
  assert.deepEqual(styles.colors[0].tokens, ['--color-ink'])
})
