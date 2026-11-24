import { execFileSync } from 'node:child_process'
import { lstatSync, mkdtempSync, readlinkSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path'

export function git(cwd, args, options = {}) {
  return execFileSync('git', args, {
    cwd, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 128 * 1024 * 1024, ...options,
  })
}

export function files(root) {
  return [...new Set(git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'])
    .toString().split('\0').filter(Boolean))]
}

export function candidateFiles(appRoot, sourceRoot) {
  // A nested app's isolated Git root cannot see its parent's ignore files or
  // repository-local exclusions. Check generated, untracked paths against both
  // projects while honoring files that were deliberately tracked in the draft.
  const tracked = git(appRoot, ['ls-files', '-z', '--cached']).toString().split('\0').filter(Boolean)
  const additions = git(appRoot, ['ls-files', '-z', '--others', '--exclude-standard']).toString().split('\0').filter(Boolean)
  if (!additions.length) return tracked
  let ignored
  try {
    ignored = git(sourceRoot, ['check-ignore', '--verbose', '--stdin', '-z'], {
      input: additions.map(name => './' + name).join('\0') + '\0',
    })
  } catch (error) {
    if (error.status !== 1) throw error
    return [...tracked, ...additions]
  }
  const repoRoot = git(sourceRoot, ['rev-parse', '--show-toplevel']).toString().trimEnd()
  const excluded = new Set()
  const fields = ignored.toString().split('\0')
  for (let index = 0; index + 3 < fields.length; index += 4) {
    const [file, , pattern, name] = fields.slice(index, index + 4)
    const rule = resolve(repoRoot, file)
    // In-app .gitignore changes are authored proposal changes. Git already
    // applied the candidate's version of those rules when listing additions.
    if (pattern.startsWith('!') || (basename(rule) === '.gitignore' && inside(sourceRoot, rule))) continue
    excluded.add(name.slice(2))
  }
  return [...tracked, ...additions.filter(name => !excluded.has(name))]
}

export function inside(root, path) {
  const distance = relative(root, path)
  return distance === '' || (distance !== '..' && !distance.startsWith('..' + sep) && !isAbsolute(distance))
}

export function directoryId(root) {
  const stat = lstatSync(root, { bigint: true })
  return stat.dev + ':' + stat.ino
}

export function validatePath(root, name) {
  const path = join(root, name)
  if (!inside(root, path) || name.split('/').includes('.git')) throw Error('Unsafe source path: ' + name)
  const stat = lstatSync(path, { throwIfNoEntry: false })
  if (!stat) return
  if (stat.isSymbolicLink()) {
    const target = readlinkSync(path)
    if (isAbsolute(target) || !inside(root, realpathSync(path))) throw Error('External project link: ' + name)
  } else if (!stat.isFile() || !inside(root, realpathSync(path))) {
    throw Error('Expected an ordinary project file: ' + name)
  }
  return stat
}

export function commitTree(appRoot, tree, parent, label) {
  const args = ['-c', 'user.name=Localhost Inspector', '-c', 'user.email=inspector@localhost',
    'commit-tree', tree, '-m', label]
  if (parent) args.push('-p', parent)
  return git(appRoot, args).toString().trim()
}

// A private index lets the three-way merge inspect both workspaces without
// staging, stashing or otherwise disturbing the user's Git index.
export function snapshot(root, appRoot, basis, names, objectEnvironment = {}) {
  const tmp = mkdtempSync(join(tmpdir(), 'inspector-proposal-index-'))
  const options = { env: { ...process.env, GIT_DIR: join(appRoot, '.git'), GIT_WORK_TREE: root,
    GIT_INDEX_FILE: join(tmp, 'index'), ...objectEnvironment } }
  try {
    if (basis) git(root, ['read-tree', basis], options)
    const previous = git(root, ['ls-files', '-z'], options).toString().split('\0').filter(Boolean)
    const included = new Set(names)
    const removed = previous.filter(name => !included.has(name))
    if (removed.length) git(root, ['update-index', '--force-remove', '-z', '--stdin'], { ...options, input: removed.join('\0') + '\0' })
    for (const name of names) validatePath(root, name)
    if (names.length) git(root, ['update-index', '--add', '--remove', '-z', '--stdin'], { ...options, input: names.join('\0') + '\0' })
    return git(root, ['write-tree'], options).toString().trim()
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}


export function applyMergedChanges(appRoot, basis, currentTree, candidateTree, destination) {
  const current = commitTree(appRoot, currentTree, basis, 'Current working copy')
  const candidate = commitTree(appRoot, candidateTree, basis, 'Candidate')
  let merged
  try {
    merged = git(appRoot, ['merge-tree', '--write-tree', '--name-only', '--no-messages', current, candidate]).toString().trim()
  } catch (error) {
    if (error.status !== 1) throw error
    throw Error('Resolve overlapping changes before continuing: ' + error.stdout.toString().trim().split('\n').slice(1).join(', '))
  }
  const patch = git(appRoot, ['diff', '--no-ext-diff', '--no-renames', '--binary', '--full-index', currentTree, merged])
  if (patch.length) {
    // apply's default all-or-nothing check refuses changed context and occupied paths.
    git(destination, ['apply', '--binary', '--whitespace=nowarn', '-'], { input: patch,
      env: { ...process.env, GIT_DIR: join(appRoot, '.git'), GIT_WORK_TREE: destination } })
  }
  return merged
}
