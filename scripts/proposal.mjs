import { authoringGuidance } from './flow/authoring-guidance.mjs'
import {
  chmodSync, copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { applyMergedChanges, candidateFiles, commitTree, directoryId, files, git, inside, snapshot, validatePath } from './proposal-source.mjs'
import { checkAcceptance, checkRefresh } from './proposal-journal.mjs'

function installedDependencies(sourceRoot) {
  const repoRoot = realpathSync(git(sourceRoot, ['rev-parse', '--show-toplevel']).toString().trimEnd())
  let directory = sourceRoot
  while (inside(repoRoot, directory)) {
    const dependencies = join(directory, 'node_modules')
    if (existsSync(dependencies)) return dependencies
    if (directory === repoRoot) break
    directory = dirname(directory)
  }
}

function save(proposalDir, record) {
  const file = join(proposalDir, 'proposal.json')
  writeFileSync(file + '.tmp', JSON.stringify(record, null, 2) + '\n', { mode: 0o600 })
  renameSync(file + '.tmp', file)
}

function initializeProposal(sourceRoot, proposalDir, publish) {
  sourceRoot = realpathSync(sourceRoot)
  proposalDir = join(realpathSync(dirname(resolve(proposalDir))), basename(resolve(proposalDir)))
  if (inside(sourceRoot, proposalDir)) throw Error('Choose a proposal directory outside the source working copy.')
  if (git(sourceRoot, ['rev-parse', '--is-inside-work-tree']).toString().trim() !== 'true') throw Error('Expected a Git working copy.')
  const names = files(sourceRoot)
  mkdirSync(proposalDir, { mode: 0o700 })
  const appRoot = join(proposalDir, 'app')
  try {
    mkdirSync(appRoot)
    git(appRoot, ['init', '--quiet'])
    git(appRoot, ['config', 'inspector.sourceRoot', sourceRoot])
    git(appRoot, ['config', 'inspector.sourceDirectory', directoryId(sourceRoot)])
    writeFileSync(join(appRoot, '.git/info/exclude'), '\n/node_modules/\n/node_modules\n', { flag: 'a' })
    for (const name of names) {
      const stat = validatePath(sourceRoot, name)
      if (!stat) continue
      const src = join(sourceRoot, name)
      const dest = join(appRoot, name)
      mkdirSync(dirname(dest), { recursive: true })
      if (stat.isSymbolicLink()) symlinkSync(readlinkSync(src), dest)
      else {
        copyFileSync(src, dest)
        chmodSync(dest, stat.mode & 0o777)
      }
    }
    const tree = snapshot(appRoot, appRoot, null, names)
    const basis = commitTree(appRoot, tree, null, 'Starting working copy')
    git(appRoot, ['update-ref', 'HEAD', basis])
    git(appRoot, ['update-ref', 'refs/inspector/basis', basis])
    git(appRoot, ['read-tree', basis])
    const deps = installedDependencies(sourceRoot)
    if (deps && !existsSync(join(appRoot, 'node_modules'))) symlinkSync(deps, join(appRoot, 'node_modules'), 'dir')
    const record = { sourceRoot, appRoot, basis, status: 'draft' }
    if (publish) save(proposalDir, record)
    return record
  } catch (error) {
    rmSync(proposalDir, { recursive: true, force: true })
    throw error
  }
}

export function createProposal(sourceRoot, proposalDir) {
  return initializeProposal(sourceRoot, proposalDir, true)
}

export function readProposal(proposalDir) {
  proposalDir = realpathSync(proposalDir)
  const record = JSON.parse(readFileSync(join(proposalDir, 'proposal.json'), 'utf8'))
  const { sourceRoot, appRoot, basis } = record
  if (appRoot !== join(proposalDir, 'app') || realpathSync(appRoot) !== appRoot ||
      realpathSync(sourceRoot) !== sourceRoot || inside(sourceRoot, proposalDir) ||
      git(appRoot, ['config', '--local', 'inspector.sourceRoot']).toString().trimEnd() !== sourceRoot ||
      git(appRoot, ['config', '--local', 'inspector.sourceDirectory']).toString().trim() !== directoryId(sourceRoot) ||
      git(appRoot, ['rev-parse', 'refs/inspector/basis']).toString().trim() !== basis) {
    throw Error('The proposal origin or starting version has changed.')
  }
  return record
}

export function proposalStatus(proposalDir) {
  proposalDir = realpathSync(proposalDir)
  const record = readProposal(proposalDir)
  const { sourceRoot, appRoot, basis } = record
  const objects = mkdtempSync(join(tmpdir(), 'inspector-proposal-status-'))
  const objectEnvironment = {
    GIT_OBJECT_DIRECTORY: objects, GIT_ALTERNATE_OBJECT_DIRECTORIES: join(appRoot, '.git/objects'),
  }
  try {
    function changedPaths(root, paths) {
      const tree = snapshot(root, appRoot, basis, paths, objectEnvironment)
      const result = git(appRoot, ['diff-tree', '-r', '--no-renames', '--name-only', '-z', basis, tree],
        { env: { ...process.env, ...objectEnvironment } })
      return result.toString().split('\0').filter(Boolean)
    }
    const originalChanges = changedPaths(sourceRoot, files(sourceRoot))
    const candidateChanges = changedPaths(appRoot, candidateFiles(appRoot, sourceRoot))
    return { ...record, proposalDir, sourceChanged: originalChanges.length > 0, originalChanges, candidateChanges }
  } finally {
    rmSync(objects, { recursive: true, force: true })
  }
}

export async function refreshProposal(proposalDir, destination) {
  proposalDir = realpathSync(proposalDir)
  destination = join(realpathSync(dirname(resolve(destination))), basename(resolve(destination)))
  for (let dir = dirname(destination); ; dir = dirname(dir)) {
    if (existsSync(join(dir, 'proposal.json')) && existsSync(join(dir, 'app/.git'))) {
      throw Error('Choose a refresh directory outside existing proposals.')
    }
    if (dir === dirname(dir)) break
  }
  const lock = join(proposalDir, '.accepting')
  mkdirSync(lock)
  try {
    const prior = readProposal(proposalDir)
    if (prior.status !== 'draft') throw Error('Only a draft can be refreshed.')
    const context = await checkRefresh(proposalDir) ?? prior.context
    const fresh = initializeProposal(prior.sourceRoot, destination, false)
    try {
      git(fresh.appRoot, ['fetch', '--no-tags', '--no-write-fetch-head', prior.appRoot, 'refs/inspector/basis'])
      const candidateTree = snapshot(prior.appRoot, fresh.appRoot, prior.basis, candidateFiles(prior.appRoot, prior.sourceRoot))
      const currentTree = git(fresh.appRoot, ['rev-parse', fresh.basis + '^{tree}']).toString().trim()
      const merged = applyMergedChanges(fresh.appRoot, prior.basis, currentTree, candidateTree, fresh.appRoot)
      // A deliberately tracked draft addition can collide with an ignored,
      // existing file omitted from the new source basis. Keep the draft intact.
      const additions = git(fresh.appRoot, ['diff', '--no-renames', '--diff-filter=A', '--name-only', '-z', currentTree, merged])
      for (const name of additions.toString().split('\0').filter(Boolean)) {
        if (lstatSync(join(prior.sourceRoot, name), { throwIfNoEntry: false })) {
          throw Error('A source file outside the new basis already occupies: ' + name)
        }
      }
      git(fresh.appRoot, ['read-tree', merged])
      fresh.refreshedFrom = { proposalDir, basis: prior.basis }
      if (context !== undefined) fresh.context = context
      await checkRefresh(proposalDir)
      save(destination, fresh)
      return fresh
    } catch (error) {
      rmSync(destination, { recursive: true, force: true })
      throw error
    }
  } finally {
    rmSync(lock, { recursive: true })
  }
}

export async function acceptProposal(proposalDir) {
  proposalDir = realpathSync(proposalDir)
  const lock = join(proposalDir, '.accepting')
  mkdirSync(lock)
  try {
    const record = readProposal(proposalDir)
    const { sourceRoot, appRoot, basis } = record
    if (record.status === 'accepted') return record
    if (existsSync(join(proposalDir, 'preview-session.json'))) {
      await checkAcceptance(proposalDir)
    }
    const candidateTree = snapshot(appRoot, appRoot, basis, candidateFiles(appRoot, sourceRoot))
    if (candidateTree === git(appRoot, ['rev-parse', basis + '^{tree}']).toString().trim()) {
      throw Error('The proposal has no source changes to accept.')
    }
    const currentTree = snapshot(sourceRoot, appRoot, basis, files(sourceRoot))
    applyMergedChanges(appRoot, basis, currentTree, candidateTree, sourceRoot)
    record.status = 'accepted'
    save(proposalDir, record)
    return record
  } finally {
    rmSync(lock, { recursive: true })
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [command, ...args] = process.argv.slice(2)
  try {
    let record
    if (command === 'create' && args.length === 2) record = { ...createProposal(...args), authoringGuidance }
    else if (command === 'status' && args.length === 1) record = proposalStatus(...args)
    else if (command === 'refresh' && args.length === 2) record = await refreshProposal(...args)
    else if (command === 'accept' && args.length === 1) record = await acceptProposal(...args)
    else throw Error('Usage: proposal.mjs create <app-root> <new-directory> | status <directory> | refresh <old-directory> <new-directory> | accept <directory>')
    console.log(JSON.stringify(record, null, 2))
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
