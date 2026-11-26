import MagicString from 'magic-string'
import { verifyRecordSource } from './record-scope.mjs'

// Ordinary frontend output. Emit a conditional style at the matched render site;
// the record and its backing data are never edited.
export function planRecordRadius(root, change) {
  const proof = change.recordScope
  if (change.property !== 'border-radius' || !/^\d+(?:\.\d+)?px$/.test(change.requested))
    throw Error('Only a fixed corner radius is qualified for one record.')
  const { use, host, tree, code, ownerCode } = verifyRecordSource(root, proof)
  const prop = 'recordCornerRadius'
  if ([code, ownerCode].some(source => new RegExp('\\b'+prop+'\\b').test(source)))
    throw Error('The record presentation prop is already in use. Review its existing owner.')
  const owner = new MagicString(ownerCode), caller = new MagicString(code)
  const annotation = host.params.typeAnnotation?.typeAnnotation
  if (annotation) {
    const name = annotation.type === 'TSTypeReference' && annotation.typeName?.name
    const declarations = tree.program.body.map(s => s.declaration ?? s)
      .filter(s => s.type === 'TSInterfaceDeclaration' && s.id.name === name)
    if (declarations.length !== 1 || declarations[0].extends?.length)
      throw Error('Unable to verify the component prop declaration.')
    owner.appendLeft(declarations[0].body.start+1, '\n  '+prop+'?: string;')
  } else if (proof.file.endsWith('.tsx')) throw Error('Cannot verify the component prop type.')
  owner.appendLeft(host.params.start+1, ' '+prop+',')
  owner.appendLeft(host.root.name.end, ' style={{ borderRadius: '+prop+' }}')
  const value = JSON.stringify(proof.value)
  const condition = use.item+'.'+use.field+' === '+value+' && '+use.collection+
    '.filter(record => record.'+use.field+' === '+value+').length === 1'
  caller.appendLeft(use.opening.name.end, ' '+prop+'={'+condition+' ? '+JSON.stringify(change.requested)+' : undefined}')
  return new Map([[proof.caller,{original:code,updated:caller.toString()}],
    [proof.file,{original:ownerCode,updated:owner.toString()}]])
}
