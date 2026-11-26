import { flowPath } from '../../extension/flow-attachment.js'

const prefix = flowPath + 'authored-module/'
const encodeFile = file => file.split('/').map(encodeURIComponent).join('/')
export const authoredModulePath = file => prefix + encodeFile(file)

// Let the live Vite server handle its real base, transforms and middleware.
// This route accepts only a normal source-module request and its cache timestamp.
export function routeAuthoredModule(request, response, base, next, webRoot = '') {
  if (!request.url?.startsWith(prefix)) return false
  const [rawPath, query] = request.url.split('?', 2)
  let segments
  try {
    segments = rawPath.slice(prefix.length).split('/').map(decodeURIComponent)
  } catch {
    response.writeHead(404).end()
    return true
  }
  const file = segments.join('/')
  if (!/\.[jt]sx$/.test(file) || segments.some(segment =>
    !segment || /[\/\\\0]/.test(segment) || ['.', '..', '.git', 'node_modules'].includes(segment))) {
    response.writeHead(404).end()
    return true
  }
  if (webRoot && !file.startsWith(webRoot + '/')) {
    response.writeHead(404).end()
    return true
  }
  const module = webRoot ? file.slice(webRoot.length+1) : file
  const timestamp = new URLSearchParams(query).get('t')
  request.url = base.replace(/\/?$/, '/') + encodeFile(module) + (/^\d{13}$/.test(timestamp ?? '') ? '?t=' + timestamp : '')
  next()
  return true
}
