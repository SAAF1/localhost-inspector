import MagicString from 'magic-string'
import { fixedRadius, recordBranches } from './record-presentation.mjs'
import { verifyRecordSource } from './record-scope.mjs'

// Ordinary frontend output. Emit a conditional style at the matched render site;
// the record and its backing data are never edited.
export function planRecordRadius(root, change) {
  const proof = change.recordScope
  if (change.property !== 'border-radius' || !fixedRadius(change.requested))
    throw Error('Only a fixed corner radius is qualified for one record.')
  const { use, host, tree, code, ownerCode } = verifyRecordSource(root, proof)
  const prop = host.presentation.prop ?? 'recordCornerRadius'
  const value = JSON.stringify(proof.value)
  const unique = (collection) =>
    collection + '.filter(record => record.' + use.field + ' === ' + value + ').length === 1'
  const base = use.item + '.' + use.field + ' === ' + value + ' && ' + unique(use.collection)
  const condition =
    use.backing === use.collection
      ? base
      : '(' + base + ') && (' + use.backing + '.includes(' + use.item + ') && ' + unique(use.backing) + ')'
  const expression = condition + ' ? ' + JSON.stringify(change.requested) + ' : undefined'
  const caller = new MagicString(code)
  if (host.presentation.prop) {
    const branches = recordBranches(use, prop)
    if (!branches) throw Error('The existing radius has a different source condition.')
    const existing = branches.cases.get(proof.value)
    if (existing) caller.overwrite(existing.start, existing.end, JSON.stringify(change.requested))
    else if (branches.tail) caller.overwrite(branches.tail.start, branches.tail.end, expression)
    else caller.appendLeft(use.opening.name.end, ' ' + prop + '={' + expression + '}')
    return new Map([[proof.caller, { original: code, updated: caller.toString() }]])
  }
  if ([code, ownerCode].some((source) => new RegExp('\\b' + prop + '\\b').test(source)))
    throw Error('The record presentation prop is already in use. Review its existing owner.')
  const owner = new MagicString(ownerCode)
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
  caller.appendLeft(use.opening.name.end, ' ' + prop + '={' + expression + '}')
  return new Map([
    [proof.caller, { original: code, updated: caller.toString() }],
    [proof.file, { original: ownerCode, updated: owner.toString() }],
  ])
}
