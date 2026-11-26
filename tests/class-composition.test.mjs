import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parse } from '@babel/parser'
import { resolvedClassJoin } from '../scripts/flow/class-composition.mjs'
import { moduleReference } from '../scripts/flow/prepared-site-qualification.mjs'

test('a single unconditional module member survives a flat imported class join', () => {
  const imports = new Map([['sheet', 'src/panel.module.css']])
  const joins = new Set(['combine'])
  const read = source => {
    const tree = parse('<p className={' + source + '} />', { plugins: ['jsx'] })
    return moduleReference(tree.program.body[0].expression.openingElement, imports, joins)
  }
  assert.deepEqual(read("combine('strong label', sheet['price'])"), { file: 'src/panel.module.css', member: 'price' })
  for (const expr of ["other('strong',sheet.price)", "combine(sheet.price,sheet.other)",
    "combine(enabled && sheet.price)", "combine(sheet[key])", "combine(sheet.price,...more)"])
    assert.equal(read(expr), undefined)
})

test('a Vite alias or noncanonical entry cannot stand in for the installed joining package', async () => {
  const root = await mkdtemp(join(tmpdir(), 'class-join-'))
  try {
    const dir = join(root, 'node_modules', 'classnames')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'classnames', main: 'index.js', version: '2.3.2' }))
    const qualifies = id => resolvedClassJoin({ resolveId: async () => ({ id }) }, 'classnames', join(root, 'src/App.jsx'))
    assert.equal(await qualifies(join(dir, 'index.js')), true)
    assert.equal(await qualifies(join(dir, 'bind.js')), false)
    assert.equal(await qualifies(join(root, 'src', 'classnames.js')), false)
  } finally { await rm(root, { recursive: true, force: true }) }
})
