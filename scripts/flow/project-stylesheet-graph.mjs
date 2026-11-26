// Vite config is application code and may resolve paths with process.cwd().
// Run standalone discovery in the application's normal directory; a running
// preview supplies its existing Vite server and needs no worker.
import { fork } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { stylesheetGraph } from './stylesheet-graph.mjs'

export function discoverProjectStyles(root, projectImport, classJoin, libraries) {
	const worker = fork(
		fileURLToPath(import.meta.url),
		['--collect', String(Boolean(projectImport))],
		{
			cwd: root,
			env: { ...process.env, BROWSER: 'none' },
			execArgv: [],
			stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
		},
	)
	return new Promise((resolve, reject) => {
		let response
		worker.once('message', (value) => {
			response = value
		})
		worker.once('error', reject)
		worker.once('exit', (code, signal) => {
			if (code || signal || !response?.graph) {
				reject(
					Error(
						response?.error ??
							'Vite discovery exited before reporting its resolved entry point.',
					),
				)
				return
			}
			try {
				for (const args of response.imports) projectImport?.(...args)
				for (const args of response.joins) classJoin?.(...args)
				for (const args of response.libraries) libraries?.(...args)
				resolve(response.graph)
			} catch (err) {
				reject(err)
			}
		})
	})
}

if (
	process.argv[1] === fileURLToPath(import.meta.url) &&
	process.argv[2] === '--collect'
) {
	const imports = [],
		joins = [],
		libraries = []
	const collect = process.argv[3] === 'true'
	try {
		const graph = await stylesheetGraph(
			process.cwd(),
			undefined,
			collect ? (...args) => imports.push(args) : undefined,
			collect ? (...args) => joins.push(args) : undefined,
			collect ? (...args) => libraries.push(args) : undefined,
		)
		process.send({ graph, imports, joins, libraries })
	} catch (error) {
		process.send({ error: error.message })
		process.exitCode = 1
	} finally {
		process.disconnect()
	}
}
