import MagicString from 'magic-string'
import { fixedRadius, recordBranches } from './record-presentation.mjs'
import { verifyRecordSource } from './record-scope.mjs'

function radiusCondition(use, recordValue) {
  const value = JSON.stringify(recordValue)
  const unique = (collection) =>
    collection + '.filter(record => record.' + use.field + ' === ' + value + ').length === 1'
  const base = use.item + '.' + use.field + ' === ' + value + ' && ' + unique(use.collection)
  return use.backing === use.collection
    ? base
    : '(' + base + ') && (' + use.backing + '.includes(' + use.item + ') && ' + unique(use.backing) + ')'
}

export function planRecordRadius(root, change) {
  return planRecordRadii(root, [change])
}

// Verify every operation against the same unmodified render site before writing a single expression.
export function planRecordRadii(root, changes) {
  const proof = changes[0]?.recordScope
  const values = new Map()
  let verified
  for (const change of changes) {
    if (!proof || change.property !== 'border-radius' || !fixedRadius(change.requested))
      throw Error('Only a fixed corner radius is qualified for one record.')
    const record = change.recordScope
    const source = verifyRecordSource(root, record)
    if (record.resource) throw Error('Use the coding-agent source handoff for a selected public-data record. Verify the key, complete backing collection, record freshness and protected peers before accepting.')
    if (record.id !== proof.id || values.has(record.value) ||
      (verified && (verified.code !== source.code || verified.ownerCode !== source.ownerCode)))
      throw Error('Overlapping record edits do not have distinct values at one verified render site.')
    verified = source
    values.set(record.value, change.requested)
  }
  if (!verified) throw Error('No record edit was selected.')
  const { use, host, tree, code, ownerCode } = verified
  const prop = host.presentation.prop ?? 'recordCornerRadius'
  const caller = new MagicString(code)
  const branches = recordBranches(use, host.presentation.prop)
  if (!branches) throw Error('The existing radius has a different source condition.')
  const additions = []
  for (const [recordValue, radius] of values) {
    const existing = branches.cases.get(recordValue)
    if (existing) caller.overwrite(existing.start, existing.end, JSON.stringify(radius))
    else additions.push(radiusCondition(use, recordValue) + ' ? ' + JSON.stringify(radius))
  }
  if (additions.length) {
    const expression = [...additions, 'undefined'].join(' : ')
    if (branches.tail) caller.overwrite(branches.tail.start, branches.tail.end, expression)
    else caller.appendLeft(use.opening.name.end, ' ' + prop + '={' + expression + '}')
  }
  if (host.presentation.prop) return new Map([[proof.caller, { original: code, updated: caller.toString() }]])
  if ([code, ownerCode].some((source) => new RegExp('\\b' + prop + '\\b').test(source)))
    throw Error('The record presentation prop is already in use. Review its existing owner.')
  const owner = proof.caller === proof.file ? caller : new MagicString(ownerCode)
  const annotation = host.params.typeAnnotation?.typeAnnotation
  if (annotation) {
    const name = annotation.type === 'TSTypeReference' && annotation.typeName?.name
    const declarations = tree.program.body
      .map((s) => s.declaration ?? s)
      .filter((s) => s.type === 'TSInterfaceDeclaration' && s.id.name === name)
    if (declarations.length !== 1 || declarations[0].extends?.length)
      throw Error('Unable to verify the component prop declaration.')
    owner.appendLeft(declarations[0].body.start + 1, '\n  ' + prop + '?: string;')
  } else if (proof.file.endsWith('.tsx')) throw Error('Cannot verify the component prop type.')
  owner.appendLeft(host.params.start + 1, ' ' + prop + ',')
  owner.appendLeft(host.root.name.end, ' style={{ borderRadius: ' + prop + ' }}')
  return new Map([
    [proof.caller, { original: code, updated: caller.toString() }],
    [proof.file, { original: ownerCode, updated: owner.toString() }],
  ])
}
