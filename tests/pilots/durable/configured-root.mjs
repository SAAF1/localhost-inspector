// CLI only. Check the project's ordinary Vite entry and the same entry served
// through Inspector without launching a browser.
import assert from 'node:assert/strict'
import {
	mkdtemp,
	mkdir,
	realpath,
	symlink,
	writeFile,
	rm,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { canvas, host, port } from './hosts.mjs'
import { authoredModulePath } from '../../../scripts/flow/authored-module-route.mjs'
import { prepareProject } from '../../../scripts/flow/prepare-project.mjs'

const deps = resolve(process.argv[2])
const old = process.argv[3]
const dir = await realpath(
	await mkdtemp(join(tmpdir(), 'qualified-vite-root-')),
)
try {
	for (const nested of [true, false]) {
		const group = join(dir, nested ? 'nested' : 'root')
		const app = join(group, 'application'),
			src = join(app, 'src'),
			map = join(group, 'canvas')
		await mkdir(src, { recursive: true })
		await canvas(map)
		await symlink(join(deps, 'node_modules'), join(app, 'node_modules'))
		await writeFile(join(app, 'package.json'), '{"type":"module"}')
		await writeFile(
			join(app, 'vite.config.mjs'),
			`
      const html = { name:'app-html-entry', enforce:'pre',
        configureServer(server) {
          server.middlewares.use((req,res,next) => {
            if (req.headers.accept?.includes('text/html')) {
              res.setHeader('content-type','text/html')
              res.end('<main>fixture entry from application middleware</main>')
            } else next()
          })
        }
      }
      export default { plugins:[html], root:${nested ? "'src'" : "'.'"}, base:'/mounted/', server:{open:true} }
    `,
		)
		await writeFile(
			join(nested ? src : app, 'index.html'),
			'<main>fixture entry</main><script type="module" src="' +
				(nested ? '/main.jsx' : '/src/main.jsx') +
				'"></script>',
		)
		await writeFile(
			join(src, 'main.jsx'),
			"import React from 'react'; import sheet from './card.module.css'; export function Tile(){return <div className={sheet.card}>test</div>}",
		)
		await writeFile(join(src, 'card.module.css'), '.card {border-radius:5px}')
		const manifest = join(group, 'prepared.json')
		if (nested && old) {
			const frozen = await import(
				pathToFileURL(join(resolve(old), 'scripts/flow/prepare-project.mjs'))
			)
			await assert.rejects(
				frozen.prepareProject(app, manifest, 'root-test', 'src', undefined, {
					panelBindings: true,
				}),
				(e) => {
					console.log('preserved first setup failure:', e.message)
					return e.code === 'ENOENT' && e.path === join(app, 'index.html')
				},
			)
		}
		const found = await prepareProject(
			app,
			manifest,
			'root-test',
			'src',
			undefined,
			{ panelBindings: true },
		)
		assert.equal(
			found.stylesheetGraph.entry,
			nested ? 'src/index.html' : 'index.html',
		)
		assert.ok(
			found.sites.some(
				(s) =>
					s.file === 'src/main.jsx' &&
					s.moduleClass?.file === 'src/card.module.css',
			),
		)
		for (const clean of [true, false]) {
			const server = await host(app, map, manifest, await port(), clean)
			try {
				const base = server.origin + '/mounted/'
				assert.match(await (await fetch(base)).text(), /fixture entry/)
				const shellPath = '/__inspector-flow/?page=%2F&editor=extension'
				const htmlOptions = { headers: { accept:'text/html' } }
				assert.match(await (await fetch(base,htmlOptions)).text(), /entry from application middleware/)
				const shell = await fetch(server.origin + shellPath,htmlOptions)
				if (clean) assert.match(await shell.text(), /entry from application middleware/)
				else {
					assert.equal(shell.status,200)
					assert.match(await shell.text(), /workspace\.mjs/)
					const missing = await fetch(server.origin + '/__inspector-flow/unknown',htmlOptions)
					assert.equal(missing.status,404)
				}
				const module = nested ? 'main.jsx' : 'src/main.jsx'
				const res = await fetch(base + module)
				assert.equal(res.status, 200)
				const js = await res.text()
				assert.match(js, /Tile/)
				assert.equal(js.includes('data-li-contract'), !clean)
				if (!clean) {
					const url = server.origin + authoredModulePath('src/main.jsx')
					const source = await fetch(url)
					assert.equal(source.status, 200)
					assert.match(await source.text(), /data-li-contract/)
				}
			} finally {
				await server.close()
			}
		}
		console.log(
			'PASS ' +
				(nested ? 'configured src root' : 'standard project root') +
				' with non-root base, graph, ordinary module and authored module',
		)
	}
} finally {
	await rm(dir, { recursive: true, force: true })
}
