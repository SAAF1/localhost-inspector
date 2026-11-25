import {prepareProject} from './prepare-project.mjs'
// Explicit development recipes for qualified JSX sites. An ambiguous opening
// never inherits a previous operation. No application files are rewritten.
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parse } from '@babel/parser'
import {cssInput} from './prepared-css.mjs'
import MagicString from 'magic-string'

const styleProperties = new Set([
  'gap','padding-left','padding-right','padding-top','padding-bottom',
  'width',
  'height',
  'min-width',
  'max-width',
  'min-height',
  'max-height',
  'font-weight',
  'color',
  'background-color',
])
const runtime = 'virtual:inspector-prepared'
const runtimeSource = new URL('../../integrations/prepared-input.mjs', import.meta.url)
function walk(node, visit, owner) {
  if (!node?.type) return
  if (node.type === 'FunctionDeclaration' && /^[A-Z]/.test(node.id?.name)) owner = node
  if (!owner && node.type === 'VariableDeclarator' && node.id.type === 'Identifier') owner = node
  visit(node, owner)
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const child of value) walk(child, visit, owner)
    else if (value?.type) walk(value, visit, owner)
  }
}

export function preparedOpenings(tree) {
  const openings = []
  walk(tree.program, (node, owner) => {
    if (node.type === 'JSXElement' && owner)
      openings.push({ node: node.openingElement, children: node.children, owner })
  })
  return openings
}

export function preparedSites(root, manifest) {
  if (!manifest) return
  root = realpathSync(root)
  const read = () => JSON.parse(readFileSync(manifest, 'utf8'))
  let manifestData = read()
  const styles = new Map()
  let compatibleAlias = true
  return {
    name: 'inspector-prepared-sites',
    enforce: 'pre',
    apply: 'serve',
    config() {
      return { optimizeDeps: { include: ['react', 'react-dom'] } }
    },
    configResolved(config) {
      const path = '@/components/ui/button'
      const alias = config.resolve.alias.find(({ find }) =>
        typeof find === 'string' ? path === find || path.startsWith(find + '/') : find.test(path),
      )
      compatibleAlias = Boolean(
        alias &&
        typeof alias.find === 'string' &&
        !alias.customResolver &&
        resolve(alias.replacement + path.slice(alias.find.length)) === join(root, 'src/components/ui/button'),
      )
    },
    configureServer(server) {
      // Some copied workspaces miss native file events. Revalidate the
      // prepared files when the app document is reopened, before Vite can
      // serve a cached module from the previous source revision.
      if(manifestData.boundary){
        let timer
        const refresh=()=>{
          manifestData=prepareProject(root,manifest,manifestData.namespace,manifestData.boundary)
          server.moduleGraph.invalidateAll()
          server.ws.send({type:'full-reload'})
        }
        const schedule=(event,file)=>{
          if(!['add','unlink','change'].includes(event) || !relative(root,file).startsWith(manifestData.boundary+'/') || !/\.(?:[cm]?[jt]sx?|css)$/.test(file))return
          clearTimeout(timer);timer=setTimeout(refresh,100)
        }
        server.watcher.on('all',schedule)
        server.httpServer?.once('close',()=>{clearTimeout(timer);server.watcher.off('all',schedule)})
      }
      let stamps
      const stamp = () =>
        [
          ...new Set([
            manifest,
            ...manifestData.sites.flatMap((site) =>
              [site.file, ...(site.dependencies ?? [])].map((file) => join(root, file)),
            ),
          ]),
        ]
          .map((file) => {
            const stat = statSync(file, { throwIfNoEntry: false, bigint: true })
            return stat ? stat.mtimeNs.toString() + ':' + stat.size : '-'
          })
          .join('|')
      stamps = stamp()
      server.middlewares.use((req, res, next) => {
        if (req.headers['sec-fetch-dest'] === 'document' || req.headers['sec-fetch-dest'] === 'iframe') {
          const latest = stamp()
          if (latest !== stamps) {
            manifestData = read()
            stamps = stamp()
            server.moduleGraph.invalidateAll()
          }
        }
        next()
      })
    },
    handleHotUpdate({ file, server, modules }) {
      const changedManifest = file === manifest
      if (changedManifest) manifestData = read()
      const affected = manifestData.sites.filter(
        (site) => changedManifest || site.dependencies?.includes(relative(root, file)),
      )
      if (!affected.length) return
      const dirty = new Set(modules)
      for (const site of affected) {
        for (const mod of server.moduleGraph.getModulesByFile(join(root, site.file)) ?? []) dirty.add(mod)
      }
      for (const mod of dirty) server.moduleGraph.invalidateModule(mod)
      server.ws.send({ type: 'full-reload' })
      return []
    },
    resolveId(id) {
      if (id === runtime || id === 'virtual:inspector-prepared-registry' || styles.has(id)) return '\0' + id
    },
    load(id) {
      if (id === '\0virtual:inspector-prepared-registry')
        return (
          readFileSync(new URL('../../integrations/prepared-registry.mjs', import.meta.url), 'utf8') +
          '\nreportPreparedSites(' +
          JSON.stringify(Object.fromEntries((manifestData.retiredSites ?? []).map((id) => [id, null]))) +
          ');'
        )
      if (id === '\0' + runtime) return readFileSync(runtimeSource, 'utf8')
      return styles.get(id.slice(1))
    },
    transform(code, id) {
      const file = relative(root, id)
      if (!/\.[jt]sx$/.test(file) || file.includes('node_modules')) return
      this.addWatchFile(manifest)
      const { namespace, sites } = manifestData
      const recipes = sites.filter((site) => site.file === file)
      if (!recipes.length) return
      const tree = parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] })
      const openings = preparedOpenings(tree)
      const out = new MagicString(code)
      const revisions = {}
      let usesInput = false
      for (const [index, site] of recipes.entries()) {
        if (!/^[a-z][a-z0-9-]{0,63}$/.test(site.id) || sites.filter((s) => s.id === site.id).length !== 1)
          throw Error('Invalid prepared site identity')
        const matches = openings.filter(
          ({ node, owner }) => owner.id.name === site.owner && code.slice(node.start, node.end) === site.opening,
        )
        revisions[site.id] = null
        if (matches.length !== 1) continue
        const adapter = manifestData.buttonAdapter
        if (
          site.input &&
          adapter &&
          (!compatibleAlias ||
            !statSync(join(root, adapter.file), { throwIfNoEntry: false }) ||
            createHash('sha256')
              .update(readFileSync(join(root, adapter.file)))
              .digest('hex') !== adapter.digest)
        )
          continue
        const { node, children, owner } = matches[0]
        let slotTag
        if (site.input?.child) {
          const slots = children.filter(
            (child) =>
              child.type === 'JSXElement' &&
              child.openingElement.selfClosing &&
              code.slice(child.start, child.end) === site.input.child,
          )
          if (slots.length !== 1 || slots[0].openingElement.name.name !== site.input.choices?.[site.input.base])
            continue
          slotTag = slots[0].openingElement.name
        }
        const hash = createHash('sha256').update(
          JSON.stringify([namespace, site, code.slice(owner.start, owner.end)]),
        )
        for (const statement of tree.program.body) {
          const name = (statement.declaration ?? statement).id?.name
          if (statement.type === 'ImportDeclaration' || site.symbols?.includes(name))
            hash.update(code.slice(statement.start, statement.end))
        }
        for (const path of site.dependencies ?? []) {
          this.addWatchFile(join(root, path))
          hash.update(readFileSync(join(root, path)))
        }
        const revision = hash.digest('hex')
        revisions[site.id] = revision
        const prefix = '--li-' + revision.slice(0, 20)
        const fields = {}
        const attr = (name) => node.attributes.find((a) => a.name?.name === name)
        let markers = ''
        for (const style of site.styles ?? (site.style ? [site.style] : [])) {
          const { property, literal, attribute, unit = '', utility } = style
          const variable = site.styles ? prefix + '-' + property : prefix
          if (!styleProperties.has(property)) throw Error('Unsupported prepared style recipe')
          const value = attr(attribute)?.value
          if (!value) throw Error('Missing prepared style expression')
          const expression = code.slice(value.start, value.end)
          const start = utility || style.css
            ? ([...expression.matchAll(/[^\s'"]+/g)].find((m) => m[0] === literal)?.index ?? -1)
            : expression.indexOf(literal)
          if (start < 0 || (!utility && expression.indexOf(literal, start + literal.length) >= 0))
            throw Error('Ambiguous prepared style expression')
          // Preserve dynamic inline/sx ownership. The variable is consumed at
          // the original declaration, so hover and media rules still compete normally.
          if (utility || style.css) {
            const key=cssInput(style)
            const moduleId='virtual:inspector-'+variable.slice(2)+'.css'
            styles.set(moduleId,'@property '+key+' {syntax:"*";inherits:false;} [data-li-revision="'+revision+'"]{'+key+':var('+variable+');}')
            out.prepend('import '+JSON.stringify(moduleId)+';\n')
          } else {
            const fallback = '"var(' + variable + ', " + (' + literal + ') + ' + JSON.stringify(unit + ')')
            out.overwrite(value.start + start, value.start + start + literal.length, '(' + fallback + ')')
          }
          if (site.styles) (fields.styles ??= []).push(property)
          else fields.style = property
        }
        if (site.input) {
          if (owner.type !== 'FunctionDeclaration') throw Error('A prepared input needs a React component owner')
          const { field, options, base, attribute, choices } = site.input
          const value = attr(attribute)?.value
          const child = site.input.child
          if (
            (!value && !child) ||
            !options.includes(base) ||
            !options.every((s) => typeof s === 'string' && /^[\w-]{1,60}$/.test(s))
          )
            throw Error('Invalid prepared input')
          const state = '__liInput' + index
          out.appendLeft(
            owner.body.directives?.at(-1)?.end ?? owner.body.start + 1,
            '\nconst ' + state + ' = __liUse(' + JSON.stringify(revision) + ');\n',
          )
          if (child) {
            if (!options.every((key) => /^[A-Z][\w]*$/.test(choices?.[key])))
              throw Error('Expected registered JSX components')
            const slot = '__LiSlot' + index
            out.appendLeft(
              owner.body.start + 1,
              '\nconst ' +
                slot +
                ' = ({' +
                options.map((key) => JSON.stringify(key) + ':' + choices[key]).join(',') +
                '})[' +
                state +
                '] ?? ' +
                slotTag.name +
                ';\n',
            )
            out.overwrite(slotTag.start, slotTag.end, slot)
          } else {
            const original =
              value.type === 'JSXExpressionContainer'
                ? code.slice(value.expression.start, value.expression.end)
                : code.slice(value.start, value.end)
            let override = state
            if (choices) {
              if (!options.every((key) => /^[A-Z][\w]*$/.test(choices[key])))
                throw Error('Expected registered JSX components')
              override =
                '({' +
                options.map((key) => JSON.stringify(key) + ': <' + choices[key] + ' />').join(',') +
                '})[' +
                state +
                ']'
            }
            out.overwrite(
              value.start,
              value.end,
              '{' + state + ' == null ? (' + original + ') : ' + override + '}',
            )
          }
          markers += ' data-li-choice={' + state + ' ?? ' + JSON.stringify(base) + '}'
          if (!options.every((key) => site.input.verify?.[key]?.self || site.input.verify?.[key]?.child))
            throw Error('Expected a rendered option check')
          fields.input = { field, options, base, verify: site.input.verify }
          usesInput = true
        }
        const contract = { site: site.id, revision, file, ...fields }
        out.appendLeft(
          node.attributes.at(-1)?.end ?? node.name.end,
          markers +
            ' data-li-revision="' +
            revision +
            '" data-li-contract={' +
            JSON.stringify(JSON.stringify(contract)) +
            '}',
        )
      }
      // Report known-but-stale sites separately from an absent scene. The registry
      // contains only mappings for modules loaded in this page.
      out.prepend(
        'import { reportPreparedSites as __liReport } from "virtual:inspector-prepared-registry";\n__liReport(' +
          JSON.stringify(revisions) +
          ');\n',
      )
      if (usesInput) out.prepend('import { usePreparedInput as __liUse } from "' + runtime + '";\n')
      return { code: out.toString(), map: out.generateMap({ hires: true, source: id }) }
    },
  }
}
