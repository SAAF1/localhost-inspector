import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'

const files = new Map([
  ['/', ['index.html', 'text/html']],
  ['/about', ['index.html', 'text/html']],
  ['/device.css', ['device.css', 'text/css']],
  ['/identity.css', ['identity.css', 'text/css']],
])
createServer(async (request, response) => {
  const entry = files.get(request.url)
  if (!entry) { response.writeHead(404).end(); return }
  const [name, type] = entry
  response.writeHead(200, { 'Content-Type': type })
  response.end(await readFile(new URL(name, import.meta.url)))
}).listen(Number(process.argv[2]), '127.0.0.1')
