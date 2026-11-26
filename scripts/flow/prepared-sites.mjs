import { prepareProject } from './prepare-project.mjs'
// Explicit development recipes for qualified JSX sites. An ambiguous opening
// never inherits a previous operation. No application files are rewritten.
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { parse } from '@babel/parser'
import { cssInput, cssReady, paddingParts, sides } from './prepared-css.mjs'
import MagicString from 'magic-string'
import { addAuthoredUseMarkers } from './authored-use.mjs'
import { preparedOpenings, preparedStyleTargets, preparedRevision } from './prepared-site-qualification.mjs'

const runtime = 'virtual:inspector-prepared'
const runtimeSource = new URL('../../integrations/prepared-input.mjs', import.meta.url)

export function preparedSites(root, manifest, { authoredUseSchema = 0 } = {}) {
  if (!manifest) return
  root = realpathSync(root)
  const read = () => JSON.parse(readFileSync(manifest, 'utf8'))
  const runtimeKey = ({ sites, retiredSites, utilityEntry, buttonAdapter, preparation }) =>
    JSON.stringify([sites, retiredSites, utilityEntry, buttonAdapter, preparation?.preparedStyles])
  let manifestData = read()
  // Watch the inputs directly. Making generated CSS an import of every
  // prepared component makes an ordinary CSS update recreate React contexts.
  const watchInputs = server => server.watcher.add([manifest, ...new Set(
    manifestData.sites.flatMap(site => (site.dependencies ?? []).map(path => join(root, path))))])
  const styles = new Map()
  let compatibleAlias = true
  return {
    name: 'inspector-prepared-sites',
    enforce: 'pre',
    apply: 'serve',
    transformIndexHtml() {
      if (manifestData.preparation?.preparedStyles === 'unavailable') {
        return [{ tag: 'meta', attrs: { name: 'inspector-prepared-styles', content: 'unavailable' }, injectTo: 'head' }]
      }
    },
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
      watchInputs(server)
      // Some copied workspaces miss native file events. Revalidate the
      // prepared files when the app document is reopened, before Vite can
      // serve a cached module from the previous source revision.
      if (manifestData.boundary) {
        let timer
        let queue = Promise.resolve()
        const refresh = async () => {
          const before = runtimeKey(manifestData)
          try {
            const next = await prepareProject(
              root,
              manifest,
              manifestData.namespace,
              manifestData.boundary,
              server,
            )
            manifestData = next
            if (runtimeKey(next) === before) return
            watchInputs(server)
          } catch (error) {
            server.config.logger.warn('Inspector discovery could not refresh: ' + error.message)
            return
          }
          server.moduleGraph.invalidateAll()
          server.ws.send({ type: 'full-reload' })
        }
        const schedule = (event, file) => {
          const path = relative(root, file)
          const config =
            /^(?:(?:vite|postcss|tailwind)\.config\.[\w]+|package(?:-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lock)$/.test(
              path,
            )
          if (
            !['add', 'unlink', 'change'].includes(event) ||
            (!config &&
              path !== 'index.html' &&
              !manifestData.stylesheetGraph?.sheets.some((s) => s.file === path) &&
              !(path.startsWith(manifestData.boundary + '/') && /\.(?:[cm]?[jt]sx?|css)$/.test(path)))
          )
            return
          clearTimeout(timer)
          timer = setTimeout(() => {
            queue = queue.then(refresh)
          }, 100)
        }
        server.watcher.on('all', schedule)
        server.httpServer?.once('close', () => {
          clearTimeout(timer)
          server.watcher.off('all', schedule)
        })
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
      if (changedManifest) {
        const next = read()
        const unchanged = runtimeKey(next) === runtimeKey(manifestData)
        manifestData = next
        if (unchanged) return []
        watchInputs(server)
      }
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
    transform: {
      order: 'pre',
      async handler(code, id) {
        const file = relative(root, id)
        if (!/\.[jt]sx$/.test(file) || file.startsWith('../') || file.includes('node_modules')) return
        const { namespace, sites } = manifestData
        const recipes = sites.filter((site) => site.file === file)
        if (!recipes.length && !authoredUseSchema) return
        let tree
        try {
          tree = parse(code, { sourceType: 'module', plugins: ['jsx', 'typescript'] })
        } catch (error) {
          if (recipes.length) throw error
          return
        }
        const openings = preparedOpenings(tree)
        const out = new MagicString(code)
        const revisions = {}
        const registrationsForModule = new Set()
        const dependencies = new Map()
        let usesInput = false
        const reserved = new Set()
        for (const [index, site] of recipes.entries()) {
          if (typeof site.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(site.id)) continue
          revisions[site.id] = null
          if (sites.filter((s) => s.id === site.id).length !== 1) continue
          const matches = openings.filter(
            ({ node, owner }) => owner.id.name === site.owner && code.slice(node.start, node.end) === site.opening,
          )
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
          const attr = (name) => node.attributes.find((a) => a.name?.name === name)
          const targets = preparedStyleTargets(site, node, code)
          if (!targets) continue
          if (site.input) {
            const { options, base, attribute, child, choices, verify } = site.input
            if (
              owner.type !== 'FunctionDeclaration' ||
              (!attr(attribute)?.value && !child) ||
              !Array.isArray(options) ||
              !options.includes(base) ||
              !options.every(
                (key) =>
                  typeof key === 'string' &&
                  /^[\w-]{1,60}$/.test(key) &&
                  (verify?.[key]?.self || verify?.[key]?.child) &&
                  (!(choices || child) || /^[A-Z][\w]*$/.test(choices?.[key] ?? '')),
              )
            )
              continue
          }
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
          const revision = preparedRevision(root, namespace, site, code, tree, owner, dependencies)
          if (!revision) continue
          revisions[site.id] = revision
          reserved.add(node.start)
          const prefix = '--li-' + revision.slice(0, 20)
          const fields = {}
          let markers = ''
          for (const { style, start, end } of targets) {
            const { property, literal, unit = '', utility } = style
            const variable = site.styles ? prefix + '-' + property : prefix
            // Preserve dynamic inline/sx ownership. The variable is consumed at
            // the original declaration, so hover and media rules still compete normally.
            if (utility || style.css) {
              const shorthand = style.css?.declaration === 'padding'
              const key = cssInput(shorthand ? { ...style, property: 'padding' } : style)
              if (utility?.axis === 'inline') (fields.logicalInline ??= []).push(property)
              const marker = cssReady(style)
              const registrations = [key, marker]
                .map((name) => '@property ' + name + ' {syntax:"*";inherits:false;}')
                .join(' ')
              let binding = key + ':var(' + variable + ');'
              if (shorthand) {
                const fallback = paddingParts(style.css.value)[sides.indexOf(property.slice(8))]
                binding =
                  key + ':var(' + prefix + '-padding);' + prefix + '-base-' + property + ':' + fallback + ';'
              }
              registrationsForModule.add(registrations + ' [data-li-revision="' + revision + '"]{' + binding + '}')
              ;(fields.cssReady ??= {})[property] = marker
            } else {
              const fallback = '"var(' + variable + ', " + (' + literal + ') + ' + JSON.stringify(unit + ')')
              out.overwrite(start, end, '(' + fallback + ')')
            }
            if (site.styles) (fields.styles ??= []).push(property)
            else fields.style = property
          }
          if (site.input) {
            const { field, options, base, attribute, choices } = site.input
            const value = attr(attribute)?.value
            const child = site.input.child
            const state = '__liInput' + index
            out.appendLeft(
              owner.body.directives?.at(-1)?.end ?? owner.body.start + 1,
              '\nconst ' + state + ' = __liUse(' + JSON.stringify(revision) + ');\n',
            )
            if (child) {
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
        if (authoredUseSchema) {
          const marked = await addAuthoredUseMarkers({
            root, file, code, tree, out, reserved, schema: authoredUseSchema,
            resolveImport: async (specifier) => (await this.resolve(specifier, id))?.id,
          })
          if (!recipes.length) return marked ? { code: out.toString(), map: out.generateMap({ hires: true, source: id }) } : undefined
        }
        // Report known-but-stale sites separately from an absent scene. The registry
        // contains only mappings for modules loaded in this page.
        out.prepend(
          'import { reportPreparedSites as __liReport } from "virtual:inspector-prepared-registry";\n__liReport(' +
            JSON.stringify(revisions) +
            ');\n',
        )
        if (registrationsForModule.size) {
          const css = [...registrationsForModule].join('\n')
          const moduleId = 'virtual:inspector-' + createHash('sha256').update(css).digest('hex') + '.css'
          styles.set(moduleId, css)
          out.prepend('import ' + JSON.stringify(moduleId) + ';\n')
        }
        if (usesInput) out.prepend('import { usePreparedInput as __liUse } from "' + runtime + '";\n')
        return { code: out.toString(), map: out.generateMap({ hires: true, source: id }) }
      },
    },
  }
}
