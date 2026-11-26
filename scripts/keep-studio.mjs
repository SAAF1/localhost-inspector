// Stage the supported native edits in one candidate. Verification and acceptance
// still use the existing handoff workflow and the proposal's three-way merge.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { planRecordRadius } from './flow/record-radius.mjs'
import { candidateHandoff } from './proposal-journal.mjs'
import { readProposal } from './proposal.mjs'
import MagicString from 'magic-string'
import { parse } from '@babel/parser'
import { preparedSites, preparedOpenings } from './flow/prepared-sites.mjs'

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
  const manifest = join(dir, 'prepared.json'),
    sites = JSON.parse(readFileSync(manifest, 'utf8')).sites
  const plugin = preparedSites(appRoot, manifest)
  const handoff = candidateHandoff(dir),
    files = new Map()
  const recordFiles = new Map()
  for (const op of handoff.operations) {
    if (op.status !== 'pending') throw Error('Review blocked operations before retaining this design.')
    for (const change of op.changes) {
      if (op.scope === 'selected-record') {
        for (const [file, contents] of planRecordRadius(appRoot, change)) {
          if (files.has(file) || recordFiles.has(file)) throw Error('Overlapping source edits need a combined handoff.')
          recordFiles.set(file, contents)
        }
        continue
      }
      const prepared = change.prepared,
        site = sites.find((s) => s.id === prepared?.site)
      if (!site || site.file !== prepared.file || !/^src\/[\w/.$()-]+\.[jt]sx$/.test(site.file))
        throw Error('This operation needs an individual source handoff.')
      if (recordFiles.has(site.file)) throw Error('Overlapping source edits need a combined handoff.')
      if (!files.has(site.file)) {
        const path = join(appRoot, site.file),
          original = readFileSync(path, 'utf8')
        const transformed = plugin.transform.call({ addWatchFile() {} }, original, path)?.code
        files.set(site.file, { original, transformed, sites: new Map(), icons: new Set() })
      }
      const record = files.get(site.file)
      // Registry output proves identity against the live owner and all its dependencies.
      if (!record.transformed?.includes(JSON.stringify(site.id) + ':' + JSON.stringify(prepared.revision)))
        throw Error('Prepared source changed. Recheck the design before keeping it.')
      const fields = record.sites.get(site) ?? new Map()
      fields.set(change.property, change.requested)
      record.sites.set(site, fields)
    }
  }
  const temp = mkdtempSync(join(tmpdir(), 'inspector-retain-'))
  try {
    let patch = ''
    for (const [file, {original, updated}] of recordFiles) patch += patchFile(file, original, updated, temp)
    for (const [file, record] of files) {
      const out = new MagicString(record.original)
      const ast = parse(record.original, { sourceType: 'module', plugins: ['jsx', 'typescript'] })
      const openings = preparedOpenings(ast)
      for (const [site, fields] of record.sites) {
        const matched = openings.filter(
          ({ node, owner }) =>
            owner.id.name === site.owner && record.original.slice(node.start, node.end) === site.opening,
        )
        if (matched.length !== 1) throw Error('The authored use is ambiguous.')
        const { node, children } = matched[0]
        const attr = (name) => node.attributes.find((a) => a.name?.name === name)?.value
        let classes = attr('className')?.value
        for (const [property, value] of fields) {
          const input = site.input
          if (input && property === 'component-' + input.field && input.options.includes(value)) {
            if (input.attribute) {
              const literal = attr(input.attribute)
              if (literal?.value !== input.base) throw Error('The component input changed.')
              out.overwrite(literal.start + 1, literal.end - 1, value)
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
            const prefix = style?.literal.match(/^(gap|w|h|min-w|max-w|min-h|max-h)-/)?.[1]
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
