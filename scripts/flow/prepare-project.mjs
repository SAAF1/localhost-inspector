// Prepare literal Tailwind uses and a verified CVA/Lucide button adapter in a
// declared source boundary. Persist rejected sites next to the manifest.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from '@babel/parser'
import { baseRule, cssFields, panelCssFields, cssParser } from './prepared-css.mjs'
import { moduleReference, literalColorAttribute, panelOpening } from './prepared-site-qualification.mjs'
import { localBindingNames } from './authored-use.mjs'
import { sourceUseId } from './selection-provenance.mjs'
import { componentSurface } from './component-surface.mjs'
import { componentProof } from './component-proof.mjs'
import { componentDefinitions, returnedPart, literalStyleInput } from './component-parts.mjs'
import { forwardedHost } from './authored-forwarding.mjs'
import { stylesheetGraph } from './stylesheet-graph.mjs'
import { typeModule } from '../../component-types.mjs'

const hash = (text) => createHash('sha256').update(text).digest('hex')
const buttonSource = 'src/components/ui/button.tsx'
const buttonRevision = '97ed8ef5651a6e264ded042b024b5be39673ba2ff222017fbcf845cf3ed37226'
const dependencies = [
  'pnpm-lock.yaml',
  'vite.config.ts',
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'bun.lock',
  ...['vite.config', 'postcss.config', 'tailwind.config'].flatMap((name) =>
    ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts'].map((ext) => name + '.' + ext),
  ),
]
const variants = { outline: '.bg-background', secondary: '.bg-secondary' }
const lengths = {
  gap: 'gap',
  w: 'width',
  h: 'height',
  'min-w': 'min-width',
  'max-w': 'max-width',
  'min-h': 'min-height',
  'max-h': 'max-height',
}
function utility(token, theme) {
  const size = /^(gap|w|h|min-w|max-w|min-h|max-h)-(\d+(?:\.\d+)?|\[\d+(?:\.\d+)?px\])$/.exec(token)
  if (size)
    return {
      property: lengths[size[1]],
      fallback: size[2].startsWith('[') ? size[2].slice(1, -1) : 'calc(var(--spacing) * ' + size[2] + ')',
    }
  const weight = { 'font-medium': '500', 'font-semibold': '600', 'font-bold': '700' }[token]
  if (weight)
    return { property: 'font-weight', fallback: 'var(--font-weight-' + token.slice(5) + ', ' + weight + ')' }
  if (token === 'bg-transparent') return { property: 'background-color', fallback: 'transparent' }
  const paint = /^(text|bg)-([a-z]+(?:-[a-z]+)*)$/.exec(token)
  if (paint && theme.includes('--color-' + paint[2] + ': var(--' + paint[2] + ')')) {
    return { property: paint[1] === 'text' ? 'color' : 'background-color', fallback: 'var(--' + paint[2] + ')' }
  }
}
const safeIcon = (name) => /^[A-Z][A-Za-z]+$/.test(name)
const kebab = (name) => name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
function analyze(code, file, config) {
  const tree = config.tree
  const locals = config.panelBindings && localBindingNames(tree)
  const { imports } = typeModule(tree, file)
  const icons = [...imports].filter(([, spec]) => spec.from === 'lucide-react' && safeIcon(spec.name))
  const modules = new Map()
  const joins = new Set()
  if (config.panelBindings) for (const statement of tree.program.body) {
    if (statement.type !== 'ImportDeclaration' || statement.importKind === 'type') continue
    const path = config.resolved.get(JSON.stringify([file, statement.source.value]))
    const spec = statement.specifiers.find(entry => entry.type === 'ImportDefaultSpecifier')
    if (spec && !locals.has(spec.local.name) && config.classJoins.has(JSON.stringify([file, statement.source.value])))
      joins.add(spec.local.name)
    if (spec && path?.endsWith('.module.css') && !locals.has(spec.local.name)) modules.set(spec.local.name, path)
  }
  const found = [],
    rejected = []
  function visit(node, owner, parentElement) {
    if (!node?.type) return
    if (node.type === 'FunctionDeclaration' && /^[A-Z]/.test(node.id?.name)) owner = node
    if (!owner && node.type === 'VariableDeclarator' && node.id.type === 'Identifier') owner = node
    if (node.type === 'JSXElement') {
      const opening = node.openingElement
      const text = code.slice(opening.start, opening.end)
      const name = opening.name.name
      const entry = { file, owner: owner?.id.name, line: opening.loc.start.line }
      const attr = (key) => opening.attributes.find((a) => a.name?.name === key)?.value
      const classes = attr('className')?.value
      const reference = moduleReference(opening, modules, joins)
      const moduleClass = reference && config.css.moduleClasses.get(JSON.stringify([reference.file, reference.member]))
      const moduleUse = moduleClass && /^[a-z]/.test(name)
      const raw = {
        id: sourceUseId(file, entry.owner, text),
        file,
        owner: entry.owner,
        opening: text,
        dependencies: config.dependencies,
      }
      const host = config.panelBindings && /^[A-Z]/.test(name) && !locals.has(name) && config.forwarded(file, imports.get(name))
      // Keep the existing qualified Button adapter ahead of style discovery.
      const panelHost = host && !(config.button && imports.get(name)?.from === '@/components/ui/button')
      if (panelHost) raw.dependencies = [...raw.dependencies, host.path]
      const surface = reference && componentSurface(node, {config,file,code,imports,locals,outer:moduleClass,reference})
      const fixedHeight = config.panelBindings && !locals.has(name) && /^[A-Z]/.test(name) && literalStyleInput(opening,'height')
      const def = fixedHeight && config.definition(file, imports.get(name))
      const part = def && returnedPart(def, opening, config.hostLibrary)
      const styleProp = part && part.host.attributes.find(a=>a.name?.name==='style')?.value?.expression
      const forwardsStyle = part && styleProp?.type==='Identifier' && styleProp.name === part.props.get('style')
      let reason = 'no qualified operation'
      if (!owner || opening.attributes.some((a) => a.type === 'JSXSpreadAttribute'))
        reason = 'opaque owner or spread'
      else if (surface) {
        found.push({ ...raw, moduleClass:reference, surface:surface.surface, styles:surface.styles, componentProof:config.proof(surface.componentFiles),
          dependencies:[...new Set([...raw.dependencies,...surface.dependencies,...config.css.tokenFiles])] })
        reason=null
      } else if (forwardsStyle) {
        found.push({ ...raw, componentProof:config.proof(def.files), dependencies:[...new Set([...raw.dependencies,...def.files])],
          styles:[{property:'height', styleInput:true, tag:part.tag, base:fixedHeight.value}] })
        reason = null
      } else if (typeof name === 'string' && (/^[a-z]/.test(name) || panelHost) && (typeof classes === 'string' || moduleUse || !attr('className'))) {
        const tokens = (classes ?? '').split(/\s+/).filter(Boolean)
        const eligible = tokens.flatMap((literal) => {
          const declarations = config.css.classes.get(literal) ?? []
          if (declarations.length) return declarations
          if (
            config.tailwind &&
            /^px-(?:\d+(?:\.\d+)?|\[\d+(?:\.\d+)?px\])$/.test(literal) &&
            !tokens.some((t) => t !== literal && /^(?:p|px|pl|pr|ps|pe)-/.test(t.replace(/^!/, '')))
          ) {
            return ['padding-left', 'padding-right'].map((property) => ({
              property,
              attribute: 'className',
              literal,
              utility: { axis: 'inline' },
            }))
          }
          const rule = config.tailwind && utility(literal, config.theme)
          if (
            !rule ||
            tokens.some((other) => {
              if (other === literal) return false
              const plain = other.split(':').at(-1).replace(/^!|!$/g, '')
              const family =
                rule.property === 'gap'
                  ? /^gap-/
                  : rule.property === 'color'
                    ? /^text-/
                    : rule.property === 'background-color'
                      ? /^bg-/
                      : rule.property === 'font-weight'
                        ? /^font-/
                        : new RegExp('^' + literal.split(/-(?=\d|\[)/)[0] + '-')
              return family.test(plain)
            })
          )
            return []
          return [
            { property: rule.property, attribute: 'className', literal, utility: { fallback: rule.fallback } },
          ]
        })
        // The source proves forwarding. The compiled utility and actual host class
        // must still qualify in the live page, including when a merge discarded it.
        if (panelHost && config.tailwind && typeof classes === 'string') {
          const ownProperties = new Set(eligible.map(style => style.property))
          for (const literal of new Set(host.tokens)) {
            const rule = utility(literal, config.theme)
            if (!rule || !['height', 'background-color', 'border-radius', 'font-size'].includes(rule.property) || ownProperties.has(rule.property)) continue
            eligible.push({ ...rule, attribute: 'className', literal, forwarded: true,
              utility: { fallback: rule.fallback } })
          }
        }
        if (config.panelBindings && parentElement && /^[a-z]/.test(name)) {
          const parentClasses = parentElement.openingElement.attributes.find(a => a.name?.name === 'className')?.value
          if (parentClasses?.type === 'StringLiteral') for (const token of parentClasses.value.split(/\s+/)) {
            eligible.push(...(config.css.descendants.get('.' + token + ' ' + name) ?? []))
          }
        }
        if (moduleUse) {
          eligible.push(...moduleClass)
          raw.moduleClass = reference
          raw.dependencies = [...raw.dependencies, reference.file]
        }
        const styles = eligible.filter((s) => eligible.filter((x) => s.property === x.property).length === 1)
        if (config.panelBindings && !(moduleUse && attr('className')?.expression?.type === 'CallExpression') && (!attr('style') || (/^[a-z]/.test(name) && literalColorAttribute(opening))) && !config.css.indexError &&
            !opening.attributes.some(a => a.name?.name?.startsWith('data-li-'))) {
          for (const property of (moduleUse ? ['background-color', 'border-radius', 'font-size'] : ['background-color', 'border-radius', 'font-size', 'height'])) {
            if (!eligible.some(style => style.property === property))
              styles.push({ property, local: config.tailwind ? 'utilities' : 'ordinary' })
          }
        }
        if (styles.some(style => style.local) && /^[a-z]/.test(name)) {
          raw.opening = panelOpening(code, opening)
          raw.id = sourceUseId(file,entry.owner,raw.opening)
        }
        if (styles.length) {
          found.push({
            ...raw,
            styles,
            dependencies: [
              ...new Set([
                ...raw.dependencies,
                ...(styles.some((s) => s.utility) ? config.css.utilityFiles : []),
                ...styles.flatMap((s) => (s.css ? [s.css.file, ...config.css.tokenFiles] : [])),
              ]),
            ],
          })
          reason = null
        }
      } else if (
        config.button &&
        imports.get(name)?.from === '@/components/ui/button' &&
        imports.get(name).name === 'Button' &&
        owner.type === 'FunctionDeclaration'
      ) {
        const base = attr('variant')?.value
        if (Object.hasOwn(variants, base)) {
          found.push({
            ...raw,
            dependencies: [...config.dependencies, buttonSource],
            input: {
              attribute: 'variant',
              field: 'variant',
              base,
              options: Object.keys(variants),
              verify: Object.fromEntries(Object.entries(variants).map(([key, self]) => [key, { self }])),
            },
          })
          reason = null
        } else {
          const children = node.children.filter(
            (n) =>
              n.type === 'JSXElement' &&
              n.openingElement.selfClosing &&
              icons.some(([local]) => local === n.openingElement.name.name),
          )
          if (children.length === 1 && icons.length >= 2 && icons.length <= 12) {
            const choices = Object.fromEntries(icons.map(([local, spec]) => [kebab(spec.name), local]))
            const base = kebab(imports.get(children[0].openingElement.name.name).name)
            found.push({
              ...raw,
              dependencies: [...config.dependencies, buttonSource],
              input: {
                field: 'icon',
                child: code.slice(children[0].start, children[0].end),
                base,
                options: Object.keys(choices),
                choices,
                verify: Object.fromEntries(
                  Object.keys(choices).map((key) => [key, { child: ':scope > svg.lucide-' + key }]),
                ),
              },
            })
            reason = null
          } else reason = 'no verified direct finite slot or variant'
        }
      }
      if (config.panelBindings && owner && typeof name === 'string' && /^[a-z][a-z0-9-]*$/.test(name) &&
          !config.css.indexError && !opening.attributes.some(a => a.name?.name?.startsWith('data-li-'))) {
        // A native host needs no prop-forwarding assumption. Its emitted CSS
        // determines eligibility later, even for spread or dynamic class props.
        const candidate = !reason && found.at(-1)
        if (candidate) candidate.renderedBindings = true
        else {
          found.push({...raw, renderedBindings:true, styles:[]})
          reason = null
        }
      }
      if (reason) rejected.push(config.panelBindings ? {
        ...entry, sourceUse:raw.id, tag:name, importedFrom:imports.get(name)?.from,
        resolvedFile:config.resolved.get(JSON.stringify([file,imports.get(name)?.from])), reason,
      } : {...entry,reason})
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) for (const child of value) visit(child, owner, node.type === 'JSXElement' ? node : undefined)
      else if (value?.type) visit(value, owner)
    }
  }
  visit(tree.program)
  const sites = found.filter((site) => found.filter((other) => other.id === site.id).length === 1)
  for (const duplicate of found.filter((site) => !sites.includes(site)))
    rejected.push({ file, owner: duplicate.owner, reason: 'ambiguous authored use' })
  return { sites, rejected }
}
const trees = new Map()
function ordinaryCSS(root, graph, classify, panelBindings) {
  const moduleClasses = new Map()
  const descendants = new Map()
  const classes = new Map(),
    tokenFiles = [],
    spacingSources = [],
    referenced = new Set(),
    definitions = new Map()
  let indexError
  const parse = cssParser(root)
  for (const { file, served } of graph.sheets) {
    const code = readFileSync(join(root, file), 'utf8')
    const sheet = parse.parse(code, { from: file })
    const tokens = new Set()
    sheet.walkDecls((d) => {
      if (d.prop.startsWith('--')) {
        tokens.add(d.prop)
        return
      }
      if (/^(gap|padding(?:-(top|right|bottom|left))?)$/.test(d.prop))
        for (const match of d.value.matchAll(/var\((--[\w-]+)\)/g)) referenced.add(match[1])
    })
    if (tokens.size) {
      tokenFiles.push(file)
      definitions.set(file, tokens)
    }
    if (indexError) continue
    sheet.walkRules((rule) => {
      if (!baseRule(rule)) return
      const descendant = /^\.[a-zA-Z_][\w-]* [a-z][a-z0-9]*$/.test(rule.selector)
      if (!descendant && !/^\.[a-zA-Z_][\w-]*$/.test(rule.selector)) return
      const module = file.endsWith('.module.css')
      if (module && descendant) return
      const index = module ? moduleClasses : descendant ? descendants : classes
      const literal = rule.selector.slice(1)
      const key = module ? JSON.stringify([file, literal]) : descendant ? rule.selector : literal
      if (module && !index.has(key)) index.set(key, [])
      for (const d of rule.nodes) {
        if (d.type !== 'decl') continue
        try {
          for (const property of classify(d)) {
            if (module && !panelBindings && !['background-color', 'border-radius', 'font-size'].includes(property)) continue
            const list = index.get(key) ?? []
            list.push({
              attribute: 'className',
              literal,
              property,
              css: { file, served, ...(module ? { member: literal } : {}), ...(descendant ? { selector: rule.selector } : {}), declaration: d.prop, value: d.value },
            })
            index.set(key, list)
          }
        } catch (error) {
          indexError = { type: 'internal-preparation-error', capability: 'prepared-styles',
            file, selector: rule.selector, line: d.source?.start?.line, declaration: d.prop, message: error.message }
          return false
        }
      }
    })
  }
  for (const [file, names] of definitions) {
    const used = [...names].filter((name) => referenced.has(name))
    if (used.length && used.length <= 100) spacingSources.push({ file, names: used })
  }
  // Utility classification also consults this index for same-class
  // ownership. Let neither kind publish candidates from a partial index.
  if (indexError) { classes.clear(); descendants.clear(); moduleClasses.clear() }
  const variableSources = [...definitions].map(([file, names]) => ({ file, names: [...names] }))
  return { classes, moduleClasses, descendants, tokenFiles, spacingSources, variableSources, indexError }
}
export async function prepareProject(project, destination, namespace, boundary = 'src', server, {
  classifyCSS, panelBindings = false,
} = {}) {
  const root = realpathSync(project),
    source = realpathSync(join(root, boundary))
  if (!source.startsWith(root + sep) || resolve(destination).startsWith(root + sep))
    throw Error('Use an app source subdirectory and an external manifest.')
  const resolved = new Map()
  const classJoins = new Set()
  const motion = new Set()
  const graph = await stylesheetGraph(root, server, panelBindings ? (file, spec, path) => {
    if (/\.[jt]sx?$|\.module\.css$/.test(path)) resolved.set(JSON.stringify([file, spec]), path)
  } : undefined, panelBindings ? (file, spec) => classJoins.add(JSON.stringify([file, spec])) : undefined,
    panelBindings ? (file,spec) => motion.add(JSON.stringify([file,spec])) : undefined)
  const definition = componentDefinitions(root, resolved)
  const proof = componentProof(root)
  const hostLibrary = (file,spec) => motion.has(JSON.stringify([file,spec]))
  const forwarding = new Map()
  function forwarded(file, spec) {
    const path = spec && resolved.get(JSON.stringify([file, spec.from]))
    if (!path || !/\.[jt]sx$/.test(path) || realpathSync(join(root, path)) !== join(root, path)) return
    const key = JSON.stringify([path, spec.name])
    if (!forwarding.has(key)) {
      let tokens = []
      const tag = forwardedHost(readFileSync(join(root, path), 'utf8'), spec.name, { onHost(opening) {
        const value = opening.attributes.find(a => a.name?.name === 'className')?.value
        const literals = value?.type === 'StringLiteral' ? [value] : value?.expression?.arguments ?? []
        tokens = literals.filter(a => a.type === 'StringLiteral').flatMap(a => a.value.split(/\s+/))
      } })
      forwarding.set(key, tag ? { path, tokens } : null)
    }
    return forwarding.get(key)
  }
  const deps = [...new Set([...dependencies, ...graph.configuration])].filter((path) =>
    existsSync(join(root, path)),
  )
  const theme = graph.sheets
    .filter((sheet) => sheet.served.includes(graph.utilityEntries[0]))
    .map(({ file }) => readFileSync(join(root, file), 'utf8'))
    .join('\n')
  const css = ordinaryCSS(root, graph, classifyCSS ?? (panelBindings ? panelCssFields : cssFields), panelBindings)
  const tailwind = !css.indexError && graph.utilityEntries.length === 1
  const button =
    existsSync(join(root, buttonSource)) && hash(readFileSync(join(root, buttonSource))) === buttonRevision
  css.utilityFiles = graph.sheets.filter((s) => s.served.includes(graph.utilityEntries[0])).map((s) => s.file)
  const files = [],
    sites = [],
    unresolved = []
  function scan(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name),
        file = relative(root, path)
      if (entry.isDirectory() && !['node_modules', '.git', 'dist'].includes(entry.name)) {
        scan(path)
        continue
      }
      if (!entry.isFile() || !/\.[jt]sx$/.test(file) || /\.(test|spec)\.[jt]sx$/.test(file)) {
        files.push({ file, status: 'excluded' })
        continue
      }
      try {
        const code = readFileSync(path, 'utf8')
        let cached = trees.get(path)
        if (cached?.code !== code) {
          cached = {
            code,
            tree: parse(code, { sourceType: 'unambiguous', plugins: ['jsx', 'typescript', 'decorators-legacy'] }),
          }
          trees.set(path, cached)
        }
        const result = analyze(code, file, { theme, button, tailwind, panelBindings, forwarded, resolved, classJoins, definition, hostLibrary, proof, dependencies: deps, tree: cached.tree, css })
        sites.push(...result.sites)
        unresolved.push(...result.rejected)
        files.push({ file, status: 'indexed', candidates: result.sites.length })
      } catch (error) {
        files.push({ file, status: 'unresolved', reason: error.message })
      }
    }
  }
  scan(source)
  const previous = existsSync(destination) ? JSON.parse(readFileSync(destination, 'utf8')) : null
  const currentIds = new Set(sites.map((site) => site.id))
  const retiredSites =
    previous?.namespace === namespace
      ? [...new Set([...previous.sites.map((s) => s.id), ...(previous.retiredSites ?? [])])].filter(
          (id) => !currentIds.has(id),
        )
      : []
  const report = {
    version: 1,
    namespace,
    boundary,
    files,
    unresolved,
    sites,
    retiredSites,
    ...(panelBindings ? { panelBindings: true } : {}),
    spacingSources: css.spacingSources,
    variableSources: css.variableSources,
    ...(css.indexError ? { preparation: { preparedStyles: 'unavailable', diagnostics: [css.indexError] } } : {}),
    stylesheetGraph: graph,
    utilityEntry: tailwind ? graph.utilityEntries[0] : null,
    buttonAdapter: button ? { file: buttonSource, digest: buttonRevision } : null,
  }
  const tmp = destination + '.' + process.pid + '.tmp'
  const serialized = JSON.stringify(report, null, 2)
  if (previous && JSON.stringify(previous, null, 2) === serialized) return report
  writeFileSync(tmp, serialized)
  renameSync(tmp, destination)
  return report
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [project, destination, namespace, boundary] = process.argv.slice(2)
  if (!project || !destination || !namespace)
    throw Error('Usage: prepare-project APP EXTERNAL_MANIFEST NAMESPACE [SOURCE_SUBDIRECTORY]')
  const result = await prepareProject(project, destination, namespace, boundary)
  console.log(
    JSON.stringify({
      manifest: basename(destination),
      files: result.files.length,
      sites: result.sites.length,
      unresolved: result.unresolved.length,
    }),
  )
}
