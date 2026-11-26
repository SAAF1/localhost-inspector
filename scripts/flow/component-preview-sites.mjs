// Enabled only by the Inspector preview pipeline. The app builds and renders
// the same components with its own React, including in a minified bundle.
import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import MagicString from 'magic-string'
import { componentContracts, createComponentTypeResolver } from '../../component-catalog.mjs'

const runtimeFile = fileURLToPath(new URL('../../integrations/react-component-props.mjs', import.meta.url))
const runtime = 'virtual:localhost-inspector/component-props'

export function componentPreviewSites(project, {conditionalHosts=false} = {}) {
  const root = realpathSync(project)
  const resolveType = createComponentTypeResolver(root)
  const plugin = {
    name: 'inspector-component-instances',
    enforce: 'pre',
    resolveId(id) { if (id === runtime) return '\0' + runtime },
    load(id) {
      if (id === '\0' + runtime) {
        this.addWatchFile(runtimeFile)
        return readFileSync(runtimeFile, 'utf8')
      }
    },
    transform(code, id) {
      const file = relative(root, id)
      if (file.startsWith('..') || isAbsolute(file) || file.split(/[\\/]/).includes('node_modules') ||
          !/\.[cm]?[jt]sx?$/.test(file) || !code.includes('<') || code.includes('__liPreview')) return
      const output = new MagicString(code)
      const schemas = []
      try {
        componentContracts(code, file, (contract, fn, roots) => {
          const param = fn.params[0]
          if (!contract.fields.length || !['Identifier','ObjectPattern'].includes(param?.type) || fn.async || fn.generator) return
          // Composite-only wrappers own no physical layer. A root marker is an
          // explicit forwarding point; otherwise stamp literal host roots only.
          const conditional = new Set()
          if (conditionalHosts && fn.body.type==='BlockStatement') {
            for (const statement of fn.body.body) {
              if (statement.type!=='VariableDeclaration' || statement.kind!=='const') continue
              for (const {id,init} of statement.declarations) {
                if (id.type==='Identifier' && init?.type==='ConditionalExpression' &&
                    [init.consequent,init.alternate].some(branch=>branch.type==='StringLiteral' && /^[a-z][a-z0-9-]*$/.test(branch.value))) conditional.add(id.name)
              }
            }
          }
          const targets = [...roots].filter(el => /^[a-z]/.test(el.name.name) || conditional.has(el.name.name) ||
            el.attributes.some(a => a.name?.name === 'data-slot' && a.value?.type === 'StringLiteral'))
          if (!targets.length) return
          const bindingEnd = param.typeAnnotation?.start ?? param.end
          const original = code.slice(param.start, bindingEnd)
          const index = schemas.push(contract) - 1
          output.overwrite(param.start, bindingEnd, '__liPreviewInput')
          const prologue = '\nconst __liPreview = __liPreviewHook(__liPreviewSchemas[' + index + '], __liPreviewInput);\nconst ' + original + ' = __liPreview.props;\n'
          if (fn.body.type === 'BlockStatement') {
            const directives = fn.body.directives
            output.appendLeft(directives?.at(-1)?.end ?? fn.body.start + 1, prologue)
          } else {
            // Existing parentheses and TS annotations surrounding the expression
            // remain valid by introducing the block around the whole arrow body.
            const arrow = code.lastIndexOf('=>', fn.body.start)
            output.appendLeft(arrow + 2, ' {' + prologue + 'return ')
            output.appendLeft(fn.end, '; }')
          }
          for (const element of targets) {
            const at = element.attributes.at(-1)?.end ?? element.name.end
            if (conditional.has(element.name.name)) {
              output.appendLeft(at, ' {...(typeof '+element.name.name+' === "string" ? {"data-inspector-source":__liPreview.source,"data-inspector-instance":__liPreview.id} : {})}')
              continue
            }
            output.appendLeft(at, ' data-inspector-source={__liPreview.source} data-inspector-instance={__liPreview.id}')
          }
        }, (from, specifier) => {
          const resolved = resolveType(from, specifier)
          if (resolved?.module) this.addWatchFile(join(root, resolved.module.file))
          return resolved
        })
      } catch (error) {
        if (error.code === 'BABEL_PARSER_SYNTAX_ERROR') return
        throw error
      }
      if (!schemas.length) return
      output.prepend('import { useComponentPreview as __liPreviewHook } from ' + JSON.stringify(runtime) + ';\nconst __liPreviewSchemas = ' + JSON.stringify(schemas) + ';\n')
      return { code: output.toString(), map: output.generateMap({ hires: true, source: id }) }
    },
  }
  // Read the authored JSX before React refresh rewrites a forwarded component's
  // initializer. The prepared caller transform runs first in the same phase.
  if (conditionalHosts) plugin.transform = {order:'pre', handler:plugin.transform}
  return plugin
}
