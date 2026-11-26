import assert from 'node:assert/strict'
import { execFileSync, execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import test from 'node:test'
import MagicString from 'magic-string'
import { assertAuthoredReady, authoredTransactions, requireAuthoredCandidate } from '../authored-transactions.mjs'
import { journalValidators } from '../journal-records.mjs'
import { buildSourceHandoff } from '../source-handoff.mjs'
import { addAuthoredUseMarkers } from '../scripts/flow/authored-use.mjs'
import { parseAuthoredJsx } from '../scripts/flow/authored-forwarding.mjs'
import { effectivePreparedEdit } from '../journal-edits.mjs'
import { preparedOpenings, preparedRevision } from '../scripts/flow/prepared-site-qualification.mjs'
import { createProposal } from '../scripts/proposal.mjs'

const route = value => value
const read = async (file, fallback) => readFile(file, 'utf8').then(JSON.parse).catch(error => {
  if (error.code === 'ENOENT') return fallback
  throw error
})
async function atomic(file, value) {
  await writeFile(file + '.tmp', JSON.stringify(value))
  await rename(file + '.tmp', file)
}
const run = promisify(execFile)
const source = 'export function Example({summary}) { return <p>{summary}</p> }\n'

const mixedSource = 'export function Example({summary}) { return <article className="card"><p>{summary}</p></article> }\n'
const spacingSource = `import { Row } from './part'
export function Example() { return <Row className="flex justify-between"><button>Open</button><button>Delete</button></Row> }
`
const part = 'export function Row({className, ...props}) { return <div className={className} {...props}/> }'

async function fixture(t, family = 'paint', schema = 2, mixed = false) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'inspector-authored-tx-')))
  t.after(() => rmSync(home, { force: true, recursive: true }))
  const original = join(home, 'original')
  mkdirSync(original)
  writeFileSync(join(original, 'example.jsx'), family === 'paint' ? (mixed ? mixedSource : source) : spacingSource)
  if (family === 'spacing') writeFileSync(join(original, 'part.jsx'), part)
  if (mixed) writeFileSync(join(original, 'theme.css'), '.card {gap:12px}')
  execFileSync('git', ['init', '--quiet', original])
  const directory = join(home, 'proposal')
  const draft = createProposal(original, directory)
  const file = join(home, 'changes.json')
  const manifest = join(directory, 'prepared.json')
  await atomic(manifest, {namespace:'fixture', sites:[]})
  const target = join(draft.appRoot, 'example.jsx')
  let failCandidateWrite = false
  let staleResponse
  let staleChecks = 0
  let compiledBeforeWrite
  let replaceCompiledActions
  async function transformed() {
    const code = readFileSync(target, 'utf8')
    const tree = parseAuthoredJsx(code)
    const out = new MagicString(code)
    await addAuthoredUseMarkers({ root: draft.appRoot, file: 'example.jsx', code, tree, out, schema, resolveImport: specifier => specifier === './part' ? join(draft.appRoot, 'part.jsx') : null })
    return out.toString()
  }
  t.mock.method(globalThis, 'fetch', async () => {
    const written = readFileSync(target, 'utf8').includes('style=')
    if (failCandidateWrite && written) return new Response(null, { status: 500 })
    if (staleResponse && written) {
      staleResponse = false
      staleChecks++
      return new Response(compiledBeforeWrite, { headers: { 'content-type': 'application/javascript' } })
    }
    const markers = (await transformed()).matchAll(/data-li-authored-use=\{("(?:[^"\\]|\\.)+")\}/g)
    const compiled = Array.from(markers, match => {
      const use = JSON.parse(JSON.parse(match[1]))
      if (replaceCompiledActions) use.actions = replaceCompiledActions
      const payload = JSON.stringify(use).replaceAll("'", "\\'")
      return `jsx("p", { "data-li-authored-use": '${payload}' });`
    }).join('\n')
    if (!written) compiledBeforeWrite = compiled
    return new Response(compiled, { headers: { 'content-type': 'application/javascript' } })
  })
  const binding = { id: 'test-draft', origin: 'http://127.0.0.1:50505',
    source: draft.appRoot, authoredUse: { directory, basis: draft.basis } }
  const journal = { revision: 0, version: 2, edits: [], binding }
  await atomic(file, journal)
  const tx = authoredTransactions({ binding, file, read, atomic, validators: journalValidators(route) })
  async function probe(requested) {
    const matches = (await transformed()).matchAll(/data-li-authored-use=\{("(?:[^"\\]|\\.)+")\}/g)
    const use = Array.from(matches, match => JSON.parse(JSON.parse(match[1]))).find(item => item.family === family || item.actions?.includes(family))
    const descriptor = { ...use, family }
    const property = family === 'paint' ? 'color' : 'gap'
    return { descriptor, property, values: { [property]: requested } }
  }
  return { source: () => readFileSync(target, 'utf8'), target, original, tx, journal, binding, file, directory,
    failure() { failCandidateWrite = true },
    serveWrongActions() { replaceCompiledActions = ['spacing'] },
    serveOneStaleModule() { staleResponse = true },
    staleChecks: () => staleChecks,
    async addPrepared() {
      const code = readFileSync(target, 'utf8')
      const tree = parseAuthoredJsx(code)
      const { node, owner } = preparedOpenings(tree).find(({node}) => node.name.name === 'article')
      const site = { id: 'shared-card', owner: 'Example', file: 'example.jsx',
        opening: code.slice(node.start,node.end), dependencies:['theme.css'],
        styles:[{property:'gap', attribute:'className', literal:'card', css:{file:'theme.css', declaration:'gap', value:'12px'}}] }
      await atomic(manifest, {namespace:'fixture', sites:[site]})
      const revision = preparedRevision(binding.source, 'fixture', site, code, tree, owner, new Map())
      const edit = { id:randomUUID(), route:'/', property:'gap', before:'12px', requested:'19px', observed:'19px',
        target:{tag:'article'}, prepared:{file:site.file, site:site.id, revision}, restore:'unique' }
      journal.edits.push(edit)
      await atomic(file, journal)
      return edit
    },
    async preflight(requested) {
      const { descriptor, values } = await probe(requested)
      return tx.handle({ type: 'planAuthoredUse', binding: descriptor, values }, journal)
    },
    async stage(requested, before = 'rgb(0, 0, 0)', preparedTransitions) {
      const { descriptor, property, values } = await probe(requested)
      const authoredBefore = family === 'paint' ? { color: before } : { gap: 'normal', 'justify-content': 'space-between' }
      const record = { id: randomUUID(), route: '/', property, requested, observed: requested,
        before: authoredBefore[property], authoredBefore, target: { tag: descriptor.tag, slot: null, id: null } }
      return tx.handle({ type: 'saveAuthoredUse', record, values, binding: descriptor, preparedTransitions }, journal)
    },
  }
}

test('authored transaction verifies repeated writes, exports source once, and safely undoes over unrelated source changes', async t => {
  const f = await fixture(t)
  assert.throws(() => requireAuthoredCandidate({ ...f.binding, source: f.original }), /no longer an authorized candidate/)
  const unrelated = { id: 'prepared-elsewhere', route: '/', property: 'gap', before: '0px', requested: '8px',
    target: { tag: 'div' }, prepared: { file: 'elsewhere.jsx', site: 'elsewhere' }, restore: 'unique' }
  f.journal.edits.push(unrelated)
  f.serveOneStaleModule()
  const save = await f.stage('rgb(10, 20, 30)')
  assert.equal(f.staleChecks(), 1)
  assert.equal(save.edit.sourceState, 'compiled')
  assert.match(f.source(), /style=\{\{ color: "rgb\(10, 20, 30\)"/)
  await assert.rejects(assertAuthoredReady(f.binding, f.file, f.journal, read), /interrupted/)
  const verify = async (edit, color) => {
    await f.tx.handle({ type: 'verifyAuthoredUse', id: edit.id, observed: { color }, evidence: { visibleMembers: 2, protectedPeers: 1 } }, f.journal)
    Object.assign(f.journal, await read(f.file))
  }
  await verify(save.edit, 'rgb(10, 20, 30)')
  const next = await f.stage('rgb(40, 50, 60)', 'rgb(10, 20, 30)')
  await verify(next.edit, 'rgb(40, 50, 60)')
  assert.deepEqual(buildSourceHandoff(f.binding, f.journal).operations.map(edit => edit.id), [unrelated.id])
  assert.throws(() => requireAuthoredCandidate({ ...f.binding, authoredUse: { ...f.binding.authoredUse, basis: 'changed' } }), /candidate/)
  const note = '// unrelated follow-on edit\n'
  writeFileSync(f.target, note + f.source())
  await assertAuthoredReady(f.binding, f.file, f.journal, read)
  await assert.rejects(f.tx.handle({ type: 'removeEdit', id: save.edit.id }, f.journal), /newer edit/)
  await f.tx.handle({ type: 'removeEdit', id: next.edit.id }, f.journal)
  Object.assign(f.journal, await read(f.file))
  assert.equal(f.source(), note + source.replace('<p>', '<p style={{ color: "rgb(10, 20, 30)" }}>'))
  writeFileSync(f.target, f.source().replace('20, 30', '20, 35'))
  await f.tx.reportConflicts(f.journal)
  assert.equal(f.journal.edits.at(-1).sourceState, 'conflict')
  await assert.rejects(f.tx.handle({ type: 'removeEdit', id: save.edit.id }, f.journal), /changed/)
  assert.match(f.source(), /20, 35/)
  assert.equal(readFileSync(join(f.original, 'example.jsx'), 'utf8'), source)
})

test('compile and visible-verification failures restore the source and do not retain applied operations', async t => {
  const f = await fixture(t)
  const stage = await f.stage('rgb(10, 20, 30)')
  await assert.rejects(f.tx.handle({ type: 'verifyAuthoredUse', id: stage.edit.id, observed: { color: 'rgb(0, 0, 0)' } }, f.journal),
    /rendered result did not match/)
  assert.equal(f.source(), source)
  assert.equal(f.journal.edits.length, 0)
  f.failure()
  await assert.rejects(f.stage('rgb(40, 50, 60)'), /compiled module/)
  assert.equal(f.source(), source)
  assert.equal((await read(f.file)).edits.length, 0)
  assert.equal(await read(f.file + '.authored-transaction', null), null)
})

test('a failed compound spacing save rolls back both source values together', async t => {
  const f = await fixture(t, 'spacing')
  f.failure()
  await assert.rejects(f.stage('16px'), /compiled module/)
  assert.equal(f.source(), spacingSource)
  assert.equal((await read(f.file)).edits.length, 0)
  assert.equal(await read(f.file + '.authored-transaction', null), null)
})

test('new helper process restores the prior prepared binding and owned source after a staged native write', async t => {
  const f = await fixture(t, 'paint', 2, true)
  const prepared = await f.addPrepared()
  const requested = 'rgb(10, 20, 30)'
  const { preparedTransitions } = await f.preflight(requested)
  assert.equal(preparedTransitions.length, 1)
  const [transition] = preparedTransitions
  assert.equal(transition.id, prepared.id)
  assert.notEqual(transition.from, transition.to)
  await assert.rejects(f.stage(requested), /prepared edits changed/i)
  await f.stage(requested, undefined, preparedTransitions)
  const staged = await read(f.file)
  assert.equal(staged.edits[0].prepared.revision, transition.from)
  assert.equal(effectivePreparedEdit(staged.edits[0], staged).prepared.revision, transition.to)
  assert.equal((await read(f.file + '.authored-transaction')).preparedTransitions[0].to, transition.to)
  const note = '// unrelated intervening work\n'
  writeFileSync(f.target, note + f.source())
  const moduleUrl = new URL('../authored-transactions.mjs', import.meta.url).href
  await run(process.execPath, ['--input-type=module', '-e', `
    import { authoredTransactions } from ${JSON.stringify(moduleUrl)};
    import { readFile, rename, writeFile } from 'node:fs/promises';
    const [file, data] = process.argv.slice(1);
    const binding = JSON.parse(data);
    const read = (path, fallback) => readFile(path, 'utf8').then(JSON.parse).catch(error => {
      if (error.code === 'ENOENT') return fallback;
      throw error;
    });
    const atomic = async (path, value) => {
      await writeFile(path + '.tmp', JSON.stringify(value));
      await rename(path + '.tmp', path);
    };
    await authoredTransactions({ binding, file, read, atomic }).recover(await read(file));
  `, f.file, JSON.stringify(f.binding)])
  assert.equal(f.source(), note + mixedSource)
  const restored = await read(f.file)
  assert.deepEqual(restored.edits, [prepared])
  assert.equal(effectivePreparedEdit(restored.edits[0], restored).prepared.revision, transition.from)
  assert.equal(await read(f.file + '.authored-transaction', null), null)
})

test('schema two requires the compiled action list, and schema one receipts can still be verified and undone', async t => {
  const revised = await fixture(t)
  revised.serveWrongActions()
  await assert.rejects(revised.stage('rgb(2, 3, 4)'), /compiled candidate module/)
  assert.equal(revised.source(), source)
  // Unmock the first candidate module probe before creating the legacy fixture.
  t.mock.restoreAll()
  const legacy = await fixture(t, 'paint', 1)
  const saved = await legacy.stage('rgb(2, 3, 4)')
  assert.equal(saved.edit.authoredBinding.schema, 1)
  await legacy.tx.handle({ type: 'verifyAuthoredUse', id: saved.edit.id, observed: { color: 'rgb(2, 3, 4)' }, evidence: { visibleMembers: 1, protectedPeers: 0 } }, legacy.journal)
  Object.assign(legacy.journal, await read(legacy.file))
  await legacy.tx.handle({ type: 'removeEdit', id: saved.edit.id }, legacy.journal)
  assert.equal(legacy.source(), source)
})

test('same-owner transition refuses missing visible evidence and restores the previous revision', async t => {
  const f = await fixture(t, 'paint', 2, true)
  const prepared = await f.addPrepared()
  const requested = 'rgb(2, 3, 4)'
  const { preparedTransitions } = await f.preflight(requested)
  const saved = await f.stage(requested, undefined, preparedTransitions)
  await assert.rejects(f.tx.handle({ type:'verifyAuthoredUse', id:saved.edit.id, observed:{color:requested},
    evidence:{visibleMembers:6, protectedPeers:2} }, f.journal), /retained prepared effect/)
  assert.equal(f.source(), mixedSource)
  assert.deepEqual((await read(f.file)).edits,[prepared])
  writeFileSync(join(f.binding.source,'theme.css'),'.card {gap:14px}')
  await assert.rejects(f.preflight(requested), /controlling source changed/i)
})

test('both creation orders retain the prepared intent through verified Undo of source', async t => {
  const requested = 'rgb(2, 3, 4)'
  for (const preparedFirst of [true, false]) {
    const f = await fixture(t, 'paint', 2, true)
    let prepared
    if (preparedFirst) prepared = await f.addPrepared()
    const { preparedTransitions } = await f.preflight(requested)
    assert.equal(preparedTransitions.length, Number(preparedFirst))
    const saved = await f.stage(requested, undefined, preparedTransitions)
    const evidence = transitions => transitions.map(({id,to})=>({id,revision:to,visibleMembers:6}))
    const verify = async (edit, color) => {
      await f.tx.handle({ type:'verifyAuthoredUse', id:edit.id, observed:{color},
        evidence:{visibleMembers:6,protectedPeers:2}, preparedEvidence:evidence(edit.preparedTransitions ?? []) }, f.journal)
      Object.assign(f.journal, await read(f.file))
    }
    await verify(saved.edit, requested)
    if (!preparedFirst) prepared = await f.addPrepared()
    const originalRevision = prepared.prepared.revision
    const activeRevision = effectivePreparedEdit(prepared,f.journal).prepared.revision
    const undo = await f.tx.handle({type:'planAuthoredUse', id:saved.edit.id},f.journal)
    assert.equal(undo.preparedTransitions[0].from,activeRevision)
    const result = await f.tx.handle({type:'undo', id:saved.edit.id, ...undo},f.journal)
    Object.assign(f.journal,await read(f.file))
    assert.equal(result.edit.sourceState,'undoing')
    await verify(result.edit,'rgb(0, 0, 0)')
    assert.equal(f.source(),mixedSource)
    const [retained] = f.journal.edits
    assert.equal(retained.id,prepared.id)
    assert.equal(retained.prepared.revision,originalRevision)
    assert.equal(effectivePreparedEdit(retained,f.journal).prepared.revision,undo.preparedTransitions[0].to)
    t.mock.restoreAll()
  }
})
