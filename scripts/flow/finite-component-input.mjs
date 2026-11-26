// Connect an explicitly supplied public enum to the component's own class
// recipe. Actual prop receipt and the winning emitted CSS are verified at use.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { localBindingNames } from './authored-use.mjs'
import { componentContracts } from '../../component-catalog.mjs'

const cache = new WeakMap()
function unshadowedRecipe(definition, name) {
  const {tree,imports} = definition
  for (const stmt of tree.program.body) {
    const declaration = stmt.declaration ?? stmt
    if (declaration.type !== 'VariableDeclaration' || declaration.kind !== 'const') continue
    const call = declaration.declarations.find(d=>d.id.name===name)?.init
    const source = imports.get(call?.callee?.name)
    if (call?.type !== 'CallExpression' || source?.from !== 'class-variance-authority' || source.name !== 'cva') continue
    const rest = {program:{...tree.program,body:tree.program.body.filter(other=>other!==stmt)}}
    const shadow = localBindingNames(rest)
    return !shadow.has(name) && !shadow.has(call.callee.name)
  }
  return false
}
export function finiteComponentInput(root, definition, opening) {
  if (!definition) return
  let fields = cache.get(definition)
  if (!fields) {
    fields = new Map()
    componentContracts(readFileSync(join(root,definition.file),'utf8'), definition.file, (contract,fn,roots,recipes) => {
      if (fn.start !== definition.fn.start || roots.size !== 1) return
      for (const [field, recipe] of recipes) {
        if (!recipe || !unshadowedRecipe(definition,recipe.name)) continue
        const verify = recipe.choices
        const options = contract.options?.[field]
        if (options?.length >= 2 && options.length <= 12 && options.every(option => typeof option==='string' &&
            /^[a-zA-Z0-9_-]{1,60}$/.test(option) && verify?.[option]?.tokens.length))
          fields.set(field,{field,attribute:field,options,verify,component:JSON.stringify([contract.source,contract.name])})
      }
    })
    cache.set(definition,fields)
  }
  const supplied = opening.attributes.flatMap(attr => {
    const input = fields.get(attr.name?.name), value=attr.value
    return input && value?.type==='StringLiteral' && input.options.includes(value.value) ? [{...input,base:value.value}] : []
  })
  if (supplied.length === 1) return supplied[0]
}
