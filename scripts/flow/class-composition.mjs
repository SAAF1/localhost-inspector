// Support the default classnames/clsx export when Vite resolves the package's
// own entry. A same-named local function or Vite alias has no such contract.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const classJoinPackages = new Set(['classnames', 'clsx'])

export async function resolvedClassJoin(container, specifier, importer) {
  if (!classJoinPackages.has(specifier)) return false
  const result = await container.resolveId(specifier, importer, { scan: true })
  const id = result?.id
  if (!id) return false
  const marker = '/node_modules/' + specifier + '/'
  const boundary = id.lastIndexOf(marker)
  if (boundary < 0) return false
  const root = id.slice(0, boundary + marker.length)
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    return pkg.name === specifier && /^2\./.test(pkg.version) &&
      [pkg.main, pkg.module].some(entry => entry && join(root, entry) === id)
  } catch { return false }
}

// Only a flat list of static string arguments and one fixed module member
// establishes an unconditional module input. Never rerun the helper to mark it.
export function classMemberExpression(opening, joins) {
  const value = opening.attributes.find(a => a.name?.name === 'className')?.value?.expression
  if (value?.type !== 'CallExpression') return value
  if (value.callee.type !== 'Identifier' || !joins?.has(value.callee.name)) return
  const members = value.arguments.filter(arg => arg.type !== 'StringLiteral')
  if (members.length === 1 && members[0].type === 'MemberExpression') return members[0]
}
