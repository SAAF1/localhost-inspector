// Prepare literal Tailwind uses and a verified CVA/Lucide button adapter in a
// declared source boundary. Persist rejected sites next to the manifest.
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parse } from '@babel/parser'
import {baseRule,cssFields,cssParser} from './prepared-css.mjs'
import { typeModule } from '../../component-types.mjs'

const hash = (text) => createHash('sha256').update(text).digest('hex')
const buttonSource = 'src/components/ui/button.tsx'
const buttonRevision = '97ed8ef5651a6e264ded042b024b5be39673ba2ff222017fbcf845cf3ed37226'
const dependencies = [
  'src/styles/index.css',
  'src/styles/theme.css',
  'pnpm-lock.yaml',
  'vite.config.ts',
  'package.json',
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
  const paint = /^(text|bg)-([a-z]+(?:-[a-z]+)*)$/.exec(token)
  if (paint && theme.includes('--color-' + paint[2] + ': var(--' + paint[2] + ')')) {
    return { property: paint[1] === 'text' ? 'color' : 'background-color', fallback: 'var(--' + paint[2] + ')' }
  }
}
const safeIcon = (name) => /^[A-Z][A-Za-z]+$/.test(name)
const kebab = (name) => name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()
function analyze(code, file, config) {
  const tree = config.tree
  const { imports } = typeModule(tree, file)
  const icons = [...imports].filter(([, spec]) => spec.from === 'lucide-react' && safeIcon(spec.name))
  const found = [],
    rejected = []
  function visit(node, owner) {
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
      const raw = {
        id: 'use-' + hash(JSON.stringify([file, entry.owner, text])).slice(0, 24),
        file,
        owner: entry.owner,
        opening: text,
        dependencies: config.dependencies,
      }
      let reason = 'no qualified operation'
      if (!owner || opening.attributes.some((a) => a.type === 'JSXSpreadAttribute'))
        reason = 'opaque owner or spread'
      else if (typeof name === 'string' && /^[a-z]/.test(name) && typeof classes === 'string') {
        const tokens = classes.split(/\s+/)
        const eligible = tokens.flatMap((literal) => {
          const declarations=config.css.classes.get(literal)??[]
          if(declarations.length)return declarations
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
        const styles = eligible.filter((s) => eligible.filter((x) => s.property === x.property).length === 1)
        if (styles.length) {
          found.push({ ...raw, styles,dependencies:[...new Set([...raw.dependencies,...styles.flatMap(s=>s.css?[s.css.file,...config.css.tokenFiles]:[])])] })
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
      if (reason) rejected.push({ ...entry, reason })
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) for (const child of value) visit(child, owner)
      else if (value?.type) visit(value, owner)
    }
  }
  visit(tree.program)
  const sites = found.filter((site) => found.filter((other) => other.id === site.id).length === 1)
  for (const duplicate of found.filter((site) => !sites.includes(site)))
    rejected.push({ file, owner: duplicate.owner, reason: 'ambiguous authored use' })
  return { sites, rejected }
}
const trees=new Map()
function ordinaryCSS(root,source) {
  const classes=new Map(),tokenFiles=[],spacingSources=[]
  const parse=cssParser(root)
  for(const path of readdirSync(source,{recursive:true}).filter(name=>name.endsWith('.css'))){
    const file=relative(root,join(source,path)),code=readFileSync(join(root,file),'utf8')
    const sheet=parse.parse(code,{from:file})
    const tokens=new Set()
    sheet.walkDecls(/^--/, d=>{if(/^--space-[\w-]+$/.test(d.prop))tokens.add(d.prop)})
    if(tokens.size){tokenFiles.push(file);spacingSources.push({file,names:[...tokens]})}
    sheet.walkRules(rule=>{
      if(!baseRule(rule)||!/^\.[a-zA-Z_][\w-]*$/.test(rule.selector))return
      const literal=rule.selector.slice(1)
      for(const d of rule.nodes){
        if(d.type!=='decl')continue
        for(const property of cssFields(d)){
          const list=classes.get(literal)??[]
          list.push({attribute:'className',literal,property,css:{file,declaration:d.prop,value:d.value}})
          classes.set(literal,list)
        }
      }
    })
  }
  return {classes,tokenFiles,spacingSources}
}
export function prepareProject(project, destination, namespace, boundary = 'src') {
  const root = realpathSync(project),
    source = realpathSync(join(root, boundary))
  if (!source.startsWith(root + sep) || resolve(destination).startsWith(root + sep))
    throw Error('Use an app source subdirectory and an external manifest.')
  const deps = dependencies.filter((path) => existsSync(join(root, path)))
  const theme = existsSync(join(root, 'src/styles/theme.css'))
    ? readFileSync(join(root, 'src/styles/theme.css'), 'utf8')
    : ''
  const entry = join(root, 'src/styles/index.css')
  const tailwind = existsSync(entry) && /@import\s+['"]tailwindcss['"]/.test(readFileSync(entry, 'utf8'))
  const button =
    existsSync(join(root, buttonSource)) && hash(readFileSync(join(root, buttonSource))) === buttonRevision
  const css=ordinaryCSS(root,source)
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
        const code=readFileSync(path,'utf8')
        let cached=trees.get(path)
        if(cached?.code!==code){
          cached={code,tree:parse(code,{sourceType:'unambiguous',plugins:['jsx','typescript','decorators-legacy']})}
          trees.set(path,cached)
        }
        const result=analyze(code,file,{theme,button,tailwind,dependencies:deps,tree:cached.tree,css})
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
    spacingSources:css.spacingSources,
    buttonAdapter: button ? { file: buttonSource, digest: buttonRevision } : null,
  }
  const tmp = destination + '.' + process.pid + '.tmp'
  const serialized=JSON.stringify(report,null,2)
  if(previous && JSON.stringify(previous,null,2)===serialized)return report
  writeFileSync(tmp, serialized)
  renameSync(tmp, destination)
  return report
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [project, destination, namespace, boundary] = process.argv.slice(2)
  if (!project || !destination || !namespace)
    throw Error('Usage: prepare-project APP EXTERNAL_MANIFEST NAMESPACE [SOURCE_SUBDIRECTORY]')
  const result = prepareProject(project, destination, namespace, boundary)
  console.log(
    JSON.stringify({
      manifest: basename(destination),
      files: result.files.length,
      sites: result.sites.length,
      unresolved: result.unresolved.length,
    }),
  )
}
