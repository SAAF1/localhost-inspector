import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { acceptProposal, createProposal, proposalStatus, refreshProposal } from '../scripts/proposal.mjs'

function fixture(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'inspector-test-proposal-')))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const app = join(dir, 'source')
  const proposal = join(dir, 'candidate')
  mkdirSync(app)
  const git = (...args) => execFileSync('git', args, { cwd: app }).toString()
  git('init', '--quiet')
  const view = join(app, 'view.js')
  writeFileSync(view, 'original\n')
  writeFileSync(join(app, '.gitignore'), '.env\nnode_modules\n')
  git('add', '.')
  writeFileSync(view, 'uncommitted\n')
  writeFileSync(join(app, 'local.css'), 'saved locally\n')
  writeFileSync(join(app, '.env'), 'ignored\n')
  mkdirSync(join(app, 'node_modules'))
  return { app, proposal, view, git }
}

test('proposal starts from saved source and applies only its delta without touching the Git index', async t => {
  const { app, proposal, view, git } = fixture(t)
  const staged = git('diff', '--cached')
  const { appRoot } = createProposal(app, proposal)
  assert.equal(readFileSync(join(appRoot, 'view.js'), 'utf8'), 'uncommitted\n')
  assert.equal(readFileSync(join(appRoot, 'local.css'), 'utf8'), 'saved locally\n')
  assert.equal(existsSync(join(appRoot, '.env')), false)
  writeFileSync(join(appRoot, 'view.js'), 'with new section\n')
  writeFileSync(join(appRoot, 'summary.js'), 'summary\n')
  writeFileSync(join(app, 'local.css'), 'later user edit\n')
  assert.equal((await acceptProposal(proposal)).status, 'accepted')
  assert.equal((await acceptProposal(proposal)).status, 'accepted')
  assert.equal(readFileSync(view, 'utf8'), 'with new section\n')
  assert.equal(readFileSync(join(app, 'local.css'), 'utf8'), 'later user edit\n')
  assert.equal(readFileSync(join(app, 'summary.js'), 'utf8'), 'summary\n')
  assert.equal(git('diff', '--cached'), staged)
})

test('overlapping source edits keep the draft and leave all target files untouched', async t => {
  const { proposal, app, view } = fixture(t)
  const { appRoot } = createProposal(app, proposal)
  writeFileSync(join(appRoot, 'view.js'), 'proposal value\n')
  writeFileSync(join(appRoot, 'summary.js'), 'new file\n')
  writeFileSync(view, 'user value\n')
  await assert.rejects(acceptProposal(proposal), /overlapping changes.*view.js/)
  assert.equal(readFileSync(view, 'utf8'), 'user value\n')
  assert.equal(existsSync(join(app, 'summary.js')), false)
  assert.equal(JSON.parse(readFileSync(join(proposal, 'proposal.json'))).status, 'draft')
})

test('accept combines independent changes in the same file of a nested Git app', async t => {
  const { app, proposal } = fixture(t)
  const nested = join(app, 'features')
  mkdirSync(nested)
  const view = join(nested, 'page.js')
  const startingText = Array.from({ length: 20 }, (_, i) => 'line ' + i).join('\n') + '\n'
  writeFileSync(view, startingText)
  const { appRoot } = createProposal(nested, proposal)
  assert.equal(realpathSync(join(appRoot, 'node_modules')), realpathSync(join(app, 'node_modules')))
  assert.equal(existsSync(join(appRoot, 'view.js')), false)
  writeFileSync(join(appRoot, 'page.js'), startingText.replace('line 2\n', 'candidate\n'))
  writeFileSync(view, startingText.replace('line 17\n', 'later user edit\n'))
  await acceptProposal(proposal)
  assert.equal(readFileSync(view, 'utf8'), startingText.replace('line 2\n', 'candidate\n').replace('line 17\n', 'later user edit\n'))
})

test('accept respects outer project ignore rules for generated files in a nested app', async t => {
  const { app, proposal, git } = fixture(t)
  const nested = join(app, 'packages', 'web')
  mkdirSync(nested, { recursive: true })
  writeFileSync(join(app, '.gitignore'), 'packages/web/dist/\n')
  writeFileSync(join(app, '.git/info/exclude'), '*.scratch\n')
  mkdirSync(join(nested, 'dist'))
  writeFileSync(join(nested, 'dist', 'owned.js'), 'tracked\n')
  git('add', '-f', 'packages/web/dist/owned.js')
  writeFileSync(join(nested, '.gitignore'), 'icons.generated.js\n')
  const { appRoot } = createProposal(nested, proposal)
  writeFileSync(join(appRoot, '.gitignore'), '')
  writeFileSync(join(appRoot, 'icons.generated.js'), 'now source\n')
  writeFileSync(join(appRoot, 'view.js'), 'new section\n')
  writeFileSync(join(appRoot, 'build.scratch'), 'ephemeral\n')
  writeFileSync(join(appRoot, 'dist', 'generated.js'), 'build output\n')
  writeFileSync(join(appRoot, 'dist', 'owned.js'), 'updated tracked file\n')
  await acceptProposal(proposal)
  assert.equal(existsSync(join(nested, 'dist', 'generated.js')), false)
  assert.equal(existsSync(join(nested, 'build.scratch')), false)
  assert.equal(readFileSync(join(nested, 'dist', 'owned.js'), 'utf8'), 'updated tracked file\n')
  assert.equal(readFileSync(join(nested, 'view.js'), 'utf8'), 'new section\n')
  assert.equal(readFileSync(join(nested, 'icons.generated.js'), 'utf8'), 'now source\n')
})

test('status reports each draft against its saved local basis and preserves both indexes', t => {
  const { app, proposal, view, git } = fixture(t)
  const second = proposal + '-second'
  const left = createProposal(app, proposal)
  const right = createProposal(app, second)
  writeFileSync(join(left.appRoot, 'first.js'), 'one')
  writeFileSync(join(right.appRoot, 'second.js'), 'two')
  writeFileSync(view, 'a later original edit')
  writeFileSync(join(app, 'local.css'), 'staged after creation')
  git('add', 'local.css')
  const staged = git('diff', '--cached')
  const originalIndex = readFileSync(join(app, '.git/index'))
  const candidateIndex = readFileSync(join(left.appRoot, '.git/index'))
  const objectsBefore = execFileSync('git', ['count-objects', '-v'], { cwd: left.appRoot }).toString()
  for (const [path, expected] of [[proposal, 'first.js'], [second, 'second.js']]) {
    const result = proposalStatus(path)
    assert.equal(result.proposalDir, path)
    assert.equal(result.status, 'draft')
    assert.equal(result.sourceChanged, true)
    assert.deepEqual(result.originalChanges, ['local.css', 'view.js'])
    assert.deepEqual(result.candidateChanges, [expected])
  }
  assert.deepEqual(readFileSync(join(app, '.git/index')), originalIndex)
  assert.deepEqual(readFileSync(join(left.appRoot, '.git/index')), candidateIndex)
  assert.equal(execFileSync('git', ['count-objects', '-v'], { cwd: left.appRoot }).toString(), objectsBefore)
  assert.equal(git('diff', '--cached'), staged)
})

test('refresh merges candidate edits onto one new basis while retaining the original draft and its sibling', async t => {
  const { app, view, proposal, git } = fixture(t)
  const text = Array.from({ length: 20 }, (_, index) => 'row ' + index).join('\n') + '\n'
  writeFileSync(view, text)
  const draft = createProposal(app, proposal)
  const sibling = createProposal(app, proposal + '-sibling')
  draft.context = { page: '/tasks?state=open' }
  writeFileSync(join(proposal, 'proposal.json'), JSON.stringify(draft))
  writeFileSync(join(draft.appRoot, 'view.js'), text.replace('row 1\n', 'design\n'))
  writeFileSync(join(draft.appRoot, 'new.js'), 'new section')
  rmSync(join(draft.appRoot, 'local.css'))
  writeFileSync(view, text.replace('row 18\n', 'later base\n'))
  writeFileSync(join(app, 'new-source.js'), 'later addition')
  const staged = git('diff', '--cached')
  const old = proposalStatus(proposal)
  const next = JSON.parse(execFileSync(process.execPath,
    ['scripts/proposal.mjs', 'refresh', proposal, proposal + '-new'], { encoding: 'utf8' }))
  assert.deepEqual(next.context, draft.context)
  assert.deepEqual(next.refreshedFrom, { proposalDir: proposal, basis: draft.basis })
  assert.equal(readFileSync(join(next.appRoot, 'view.js'), 'utf8'), text.replace('row 1\n', 'design\n').replace('row 18\n', 'later base\n'))
  assert.equal(readFileSync(join(next.appRoot, 'new-source.js'), 'utf8'), 'later addition')
  assert.equal(existsSync(join(next.appRoot, 'local.css')), false)
  assert.equal(existsSync(join(sibling.appRoot, 'new.js')), false)
  assert.deepEqual(proposalStatus(proposal), old)
  const status = proposalStatus(proposal + '-new')
  assert.equal(status.sourceChanged, false)
  assert.deepEqual(status.candidateChanges, ['local.css', 'new.js', 'view.js'])
  assert.equal(git('diff', '--cached'), staged)
  await acceptProposal(proposal + '-new')
  assert.equal(readFileSync(view, 'utf8'), readFileSync(join(next.appRoot, 'view.js'), 'utf8'))
})

test('conflicting refresh removes only its own unfinished destination', async t => {
  const { app, proposal, view } = fixture(t)
  const draft = createProposal(app, proposal)
  const sibling = createProposal(app, proposal + '-sibling')
  writeFileSync(view, 'current\n')
  writeFileSync(join(draft.appRoot, 'view.js'), 'draft\n')
  const occupied = proposal + '-occupied'
  mkdirSync(occupied)
  writeFileSync(join(occupied, 'mine'), 'keep me')
  await assert.rejects(refreshProposal(proposal, occupied), /EEXIST/)
  assert.equal(readFileSync(join(occupied, 'mine'), 'utf8'), 'keep me')
  for (const dest of [join(sibling.appRoot, 'nested'), join(proposal, 'nested'), join(app, 'nested')]) {
    await assert.rejects(refreshProposal(proposal, dest), /outside/)
    assert.equal(existsSync(dest), false)
  }
  await assert.rejects(refreshProposal(proposal, proposal + '-new'), /overlapping changes.*view.js/)
  assert.equal(existsSync(proposal + '-new'), false)
  assert.equal(readFileSync(view, 'utf8'), 'current\n')
  assert.equal(readFileSync(join(draft.appRoot, 'view.js'), 'utf8'), 'draft\n')
})

test('refresh refuses a draft addition which collides with an existing ignored source file', async t => {
  const { app, proposal } = fixture(t)
  const draft = createProposal(app, proposal)
  writeFileSync(join(draft.appRoot, '.env'), 'draft value')
  execFileSync('git', ['add', '-f', '.env'], { cwd: draft.appRoot })
  await assert.rejects(refreshProposal(proposal, proposal + '-new'), /already occupies: .env/)
  assert.equal(readFileSync(join(app, '.env'), 'utf8'), 'ignored\n')
  assert.equal(readFileSync(join(draft.appRoot, '.env'), 'utf8'), 'draft value')
  assert.equal(existsSync(proposal + '-new'), false)
})
