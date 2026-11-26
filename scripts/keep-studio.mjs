// Stage the supported native edits in one candidate. Verification and acceptance
// still use the existing handoff workflow and the proposal's three-way merge.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { planRecordRadii } from './flow/record-radius.mjs'
import { candidateHandoff } from './proposal-journal.mjs'
import { readProposal } from './proposal.mjs'
import MagicString from 'magic-string'
import { parse } from '@babel/parser'
import { preparedOpenings, preparedRevision, preparedStyleTargets } from './flow/prepared-site-qualification.mjs'

function patchFile(file, original, updated, temp) {
  const before = join(temp, 'before'),
    after = join(temp, 'after')
  writeFileSync(before, original)
  writeFileSync(after, updated)
  try {
    execFileSync('diff', ['-u', before, after])
    return ''
  } catch (error) {
    if (error.status !== 1) throw error
    return '--- a/' + file + '\n+++ b/' + file + '\n' + error.stdout.toString().split('\n').slice(2).join('\n')
  }
}
export function keepStudio(dir) {
  const studio = JSON.parse(readFileSync(join(dir, '../studio.json'), 'utf8'))
  if (!studio.versions.some((v) => v.id !== 'original' && v.directory === dir))
    throw Error('Choose a candidate from this studio.')
  const { appRoot, status } = readProposal(dir)
  if (status === 'accepted') throw Error('This design is already accepted.')
  const { namespace, sites } = JSON.parse(readFileSync(join(dir, 'prepared.json'), 'utf8'))
  const dependencies = new Map()
  const handoff = candidateHandoff(dir),
    files = new Map()
  const recordSites = new Map()
  const recordFiles = new Map()
  for (const op of handoff.operations) {
    if (op.status !== 'pending') throw Error('Review blocked operations before retaining this design.')
    for (const change of op.changes) {
      if (op.scope === 'selected-record') {
        const siteKey = change.recordScope?.id
        const changes = recordSites.get(siteKey) ?? []
        changes.push(change)
        recordSites.set(siteKey, changes)
        continue
      }
      const prepared = change.prepared
      const matches = prepared && sites.filter(site => site.id === prepared.site)
      if (matches?.length !== 1 || matches[0].file !== prepared.file || !/^src\/[\w/.$()-]+\.[jt]sx$/.test(prepared.file))
        throw Error('This operation needs an individual source handoff.')
      const site = matches[0]
      const style = site.styles?.find(s => s.property === change.property)
      if (site.moduleClass || prepared.part || style?.css)
        throw Error('Retain this shared style through the coding-agent source handoff. Automatic retention requires a literal utility class.')
      if (!files.has(site.file)) {
        const original = readFileSync(join(appRoot, site.file), 'utf8')
        const tree = parse(original, { sourceType: 'module', plugins: ['jsx', 'typescript'] })
        files.set(site.file, { original, tree, openings: preparedOpenings(tree), sites: new Map(), icons: new Set() })
      }
      const record = files.get(site.file)
      const uses = record.openings.filter(({ node, owner }) =>
        owner.id.name === site.owner && record.original.slice(node.start, node.end) === site.opening)
      if (uses.length !== 1) throw Error('The authored use is ambiguous or changed.')
      const use = uses[0]
      // Verify the saved receipt against the live owner, imports and dependency bytes.
      const revision = preparedRevision(appRoot, namespace, site, record.original, record.tree, use.owner, dependencies)
      if (!revision || revision !== prepared.revision || !preparedStyleTargets(site, use.node, record.original))
        throw Error('Prepared source changed. Recheck the design before keeping it.')
      if (!record.sites.has(site)) record.sites.set(site, { use, fields: new Map() })
      const { fields } = record.sites.get(site)
      fields.set(change.property, change.requested)
    }
  }
  for (const changes of recordSites.values()) {
    for (const [file, contents] of planRecordRadii(appRoot, changes)) {
      if (files.has(file) || recordFiles.has(file)) throw Error('Overlapping source edits need a combined handoff.')
      recordFiles.set(file, contents)
    }
  }
  const temp = mkdtempSync(join(tmpdir(), 'inspector-retain-'))
  try {
    let patch = ''
    for (const [file, {original, updated}] of recordFiles) patch += patchFile(file, original, updated, temp)
    for (const [file, record] of files) {
      const out = new MagicString(record.original)
      for (const [site, { use, fields }] of record.sites) {
        const { node, children } = use
        const attr = (name) => node.attributes.find((a) => a.name?.name === name)?.value
        let classes = attr('className')?.value
        for (const [property, value] of fields) {
          const input = [site.input,...(site.additionalInputs ?? [])].find(input=>input && property==='component-'+input.field)
          if (input?.options.includes(value)) {
            if (input.attribute) {
              const literal = attr(input.attribute)
              if (input.implicit) {
                if (node.attributes.some(a => a.name?.name === input.attribute || a.type === 'JSXSpreadAttribute')) throw Error('The defaulted component input changed.')
                out.appendLeft(node.name.end,' '+input.attribute+'='+JSON.stringify(value))
              } else {
                if (literal?.value !== input.base) throw Error('The component input changed.')
                out.overwrite(literal.start + 1, literal.end - 1, value)
              }
            } else {
              const slots = children.filter(
                (child) =>
                  child.type === 'JSXElement' && record.original.slice(child.start, child.end) === input.child,
              )
              if (slots.length !== 1) throw Error('The direct slot changed.')
              const tag = slots[0].openingElement.name
              if (tag.name !== input.choices[input.base]) throw Error('The slot component changed.')
              out.overwrite(tag.start, tag.end, input.choices[value])
              if (tag.name !== input.choices[value]) record.icons.add(tag.name)
            }
          } else {
            const style = site.styles?.find((s) => s.property === property)
            let replacement
            const prefix = style?.literal?.match(/^(gap|w|h|min-w|max-w|min-h|max-h)-/)?.[1]
            const token = /^var\(--[\w-]+\)$/.test(value)
            if (prefix && (token || /^\d+(?:\.\d+)?px$/.test(value))) replacement = prefix + '-[' + value + ']'
            if (prefix === 'w' && value === '100%') replacement = 'w-full'
            if (prefix === 'w' && value === 'fit-content') replacement = 'w-fit'
            if (style && property === 'font-weight' && /^[1-9]00$/.test(value))
              replacement = 'font-[' + value + ']'
            if (style && ['color', 'background-color'].includes(property) && token)
              replacement = (property === 'color' ? 'text-[color:' : 'bg-[') + value + ']'
            if (!replacement || typeof classes !== 'string')
              throw Error('Retain this property through the individual source handoff.')
            const tokens = classes.split(/(\s+)/)
            if (tokens.filter((t) => t === style.literal).length !== 1) throw Error('Ambiguous utility.')
            classes = tokens.map((t) => (t === style.literal ? replacement : t)).join('')
          }
        }
        if (classes !== attr('className')?.value) {
          const literal = attr('className')
          out.overwrite(literal.start + 1, literal.end - 1, classes)
        }
      }
      record.updated = out.toString()
      for (const name of record.icons) {
        if (record.updated.match(new RegExp('\\b' + name + '\\b', 'g'))?.length !== 1) continue
        record.updated = record.updated.replace(
          /import\s*\{([^}]+)\}\s*from (['"])lucide-react\2/,
          (line, names) =>
            line.replace(
              names,
              ' ' +
                names
                  .split(',')
                  .map((n) => n.trim())
                  .filter((n) => n !== name)
                  .join(', ') +
                ' ',
            ),
        )
      }
      patch += patchFile(file, record.original, record.updated, temp)
    }
    if (!patch) throw Error('No pending native changes.')
    if (candidateHandoff(dir).revision !== handoff.revision) throw Error('The journal changed during handoff.')
    execFileSync('git', ['apply', '--whitespace=nowarn', '-'], { cwd: appRoot, input: patch })
    return {
      revision: handoff.revision,
      files: [...files.keys(), ...recordFiles.keys()],
      operations: handoff.operations.map((o) => o.id),
    }
  } finally {
    rmSync(temp, { recursive: true, force: true })
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  console.log(JSON.stringify(keepStudio(resolve(process.argv[2])), null, 2))
}
