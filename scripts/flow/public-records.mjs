import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { localBindingNames } from './authored-use.mjs'
import { identifier, member, reactReference, walk } from './record-render-path.mjs'

// Resolve a literal same-origin JSON read feeding both the rendered state and a
// full collection ref. Runtime membership and exact checked-in rows corroborate it.
export function publicRecordCollection(tree, scope, collection, locals) {
  if (scope?.body.type !== 'BlockStatement') return
  const declarations = scope.body.body.filter(s => s.type === 'VariableDeclaration' && s.kind === 'const').flatMap(s => s.declarations)
  const hook = (d, name) => d.init?.type === 'CallExpression' && reactReference(tree, d.init.callee, name, locals) &&
    d.init.arguments.length === 1 && d.init.arguments[0].type === 'ArrayExpression' && !d.init.arguments[0].elements.length
  const states = declarations.filter(d => hook(d, 'useState') && d.id.type === 'ArrayPattern' &&
    identifier(d.id.elements[0], collection) && identifier(d.id.elements[1]))
  if (states.length !== 1) return
  const setter = states[0].id.elements[1].name
  const refs = declarations.filter(d => hook(d, 'useRef') && identifier(d.id))
  const client = new Set(tree.program.body.filter(s => s.type === 'ImportDeclaration' && s.source.value === 'axios')
    .flatMap(s => s.specifiers).filter(s => s.type === 'ImportDefaultSpecifier' && !locals.has(s.local.name)).map(s => s.local.name))
  const matches = []
  // Both assignments must use the same lexical const. Restrict this path to
  // a straight-line load and a sibling pair, optionally inside an if block.
  walk(scope.body, block => {
    if (block.type !== 'BlockStatement') return
    const list = block.body
    for (let i = 0; i + 2 < list.length; i++) {
      const singleConst = s => s?.kind === 'const' && s.declarations?.length === 1 && identifier(s.declarations[0].id) && s.declarations[0]
      const response = singleConst(list[i]), rows = singleConst(list[i + 1])
      const request = response?.init?.type === 'AwaitExpression' && response.init.argument
      if (!rows || request?.type !== 'CallExpression' || request.arguments.length !== 1 || request.arguments[0].type !== 'StringLiteral') continue
      const url = request.arguments[0].value
      if (!/^(?:\.{1,2}\/|\/)?[\w./-]+\.json$/.test(url) || url.startsWith('//') || url.includes('\\')) continue
      const axios = member(request.callee, 'get') && client.has(request.callee.object.name) && member(rows.init, 'data') && identifier(rows.init.object, response.id.name)
      const parse = rows.init?.type === 'AwaitExpression' && rows.init.argument
      const fetch = identifier(request.callee,'fetch') && !locals.has('fetch') &&
        !tree.program.body.some(s => s.specifiers?.some(spec => spec.local?.name === 'fetch')) && parse?.type === 'CallExpression' &&
        member(parse.callee,'json') && identifier(parse.callee.object, response.id.name) && !parse.arguments.length
      if (!axios && !fetch) continue
      const next = list[i + 2]
      const pair = next.type === 'IfStatement' && next.consequent.type === 'BlockStatement' ? next.consequent.body : list.slice(i + 2)
      const exprs = pair.slice(0,2).map(s => s.expression)
      const save = exprs.find(e => e?.type === 'CallExpression' && identifier(e.callee,setter) &&
        e.arguments.length === 1 && identifier(e.arguments[0],rows.id.name))
      const write = exprs.find(e => e?.type === 'AssignmentExpression' && e.operator === '=' &&
        member(e.left,'current') && identifier(e.right, rows.id.name))
      const ref = refs.find(d => identifier(write?.left.object,d.id.name))
      if (!save || !ref) continue
      const shadowed = localBindingNames({program:scope}, new Set([states[0],ref,response,rows]))
      if ([collection,setter,ref.id.name,response.id.name,rows.id.name].some(name => shadowed.has(name))) continue
      matches.push({ name: ref.id.name + '.current', url, spans: [states[0],ref,response,rows,save,write] })
    }
  })
  return matches.length === 1 ? matches[0] : undefined
}

export function publicRows(root, url, field) {
  const pathname = new URL(url, 'http://localhost/').pathname
  if (!/^\/(?:[\w-]+\/)*[\w.-]+\.json$/.test(pathname)) return
  const file = join(root, 'public', pathname)
  try {
    const stat = statSync(file)
    if (!stat.isFile() || stat.size > 65536 || realpathSync(file) !== file) return
    const rows = JSON.parse(readFileSync(file, 'utf8'))
    if (!Array.isArray(rows) || !rows.length || rows.length > 256) return
    const seen = new Set()
    const entries = []
    for (const row of rows) {
      const value = row?.[field]
      if (!row || Array.isArray(row) || typeof row !== 'object' || !Object.hasOwn(row,field) ||
        !(Number.isSafeInteger(value) || (typeof value === 'string' && /^[^\x00-\x1f\x7f]{1,70}$/u.test(value) && value.trim())) || seen.has(String(value))) return
      seen.add(String(value))
      const json = JSON.stringify(row)
      const revision = createHash('sha256').update(json).digest('hex').slice(0, 24)
      entries.push({value,json,revision})
    }
    return { file, pathname, entries }
  } catch { return }
}
