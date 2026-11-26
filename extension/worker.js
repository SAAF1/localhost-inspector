import { inspectorModules } from './inspector-modules.js'
import { dockFlowInspector, flowPath, isFlowChild, watchFlowFrame } from './flow-attachment.js'
import { componentPreviewRequest, previewButtonSize } from './component-preview.js'
import { captureEditEvidence } from './capture-evidence.js'

const defaultPort = 5188
const setting = 'helperKey'
const pendingCaptures = new Map()
const flowAttachments = new Map()

async function helper(key, request, port = defaultPort) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Choose a valid local helper port')
  const endpoint = 'http://127.0.0.1:' + port + '/inspector'
  if (!key) throw Error('Pair the local helper in extension settings')
  const response = await fetch(endpoint, {
    method: 'POST', redirect: 'error',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(4500),
  })
  const data = await response.json()
  if (!response.ok) throw Object.assign(Error(data.error), { code: data.code })
  return data.value
}

async function call(request) {
  const pair = await chrome.storage.local.get([setting, 'helperPort'])
  return helper(pair[setting], request, pair.helperPort)
}

function localOrigin(url) {
  if (!url) return null
  const address = new URL(url)
  return address.protocol === 'http:' && address.hostname === '127.0.0.1' && address.port !== '5188'
    ? address.origin : null
}

async function inject(target) {
  const [{ result: mounted }] = await chrome.scripting.executeScript({
    target, func: () => Boolean(window.phaseAInspectorReady),
  })
  if (!mounted) {await chrome.scripting.executeScript({ target, files: inspectorModules })}
}

// Chrome matches the complete loopback origin, including the candidate port.
const returnScriptId = tabId => 'inspector-return-' + tabId

async function attach(tabId, origin) {
  const { id: binding } = await call({ type: 'check', origin })
  const tab = await chrome.tabs.get(tabId)
  if (localOrigin(tab.url) !== origin) return
  const id = returnScriptId(tabId)
  const script = { id, matches: [origin + '/*'], js: ['return-attachment.js'], persistAcrossSessions: false }
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] })
  if (existing.length) await chrome.scripting.updateContentScripts([script])
  else await chrome.scripting.registerContentScripts([script])
  await chrome.storage.session.set({ ['tab:' + tabId]: { origin, binding } })
  // Registration covers subsequent documents; the current page is already loaded.
  await chrome.scripting.executeScript({ target: { tabId }, files: script.js })
}

async function mountInspector(sender, grant) {
  const tabId = sender.tab.id
  await call({ type: 'check', origin: grant.origin, expectedBindingId: grant.binding })
  const target = { tabId, documentIds: [sender.documentId] }
  pendingCaptures.delete(tabId)
  if (new URL(sender.url).pathname === flowPath) {
    await chrome.scripting.executeScript({ target, func: watchFlowFrame })
  } else {
    await chrome.storage.session.remove('flow:' + tabId)
    await inject(target)
  }
  await chrome.action.setBadgeText({ tabId, text: '' })
  await chrome.action.setTitle({ tabId, title: 'Attach Localhost Inspector' })
}

function queueFlowAttachment(tabId, origin, documentId) {
  const previous = flowAttachments.get(tabId) ?? Promise.resolve()
  const active = previous.catch(() => {}).then(() => attachFlowFrame(tabId, origin, documentId))
  flowAttachments.set(tabId, active)
  return active.finally(() => {
    if (flowAttachments.get(tabId) === active) flowAttachments.delete(tabId)
  })
}

async function attachFlowFrame(tabId, origin, documentId) {
  const tab = await chrome.tabs.get(tabId)
  if (localOrigin(tab.url) !== origin || new URL(tab.url).pathname !== flowPath) return
  const key = 'flow:' + tabId
  const target = { tabId, documentIds: [documentId] }
  const [{ result: selected }] = await chrome.scripting.executeScript({ target, func: isFlowChild, args: [flowPath] })
  if (!selected) return
  await chrome.storage.session.set({ [key]: documentId })
  await chrome.scripting.executeScript({ target, func: dockFlowInspector })
  await inject(target)
  await chrome.scripting.executeScript({ target, func: async () => { await window.phaseAInspectorReady } })
  return documentId
}

async function failed(tabId, error) {
  await chrome.action.setBadgeText({ tabId, text: '!' })
  await chrome.action.setTitle({ tabId, title: error.message })
}

chrome.action.onClicked.addListener(tab => {
  const origin = localOrigin(tab.url)
  if (origin) void attach(tab.id, origin).catch(error => failed(tab.id, error))
})
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'loading') pendingCaptures.delete(tabId)
})
chrome.tabs.onRemoved.addListener(tabId => {
  pendingCaptures.delete(tabId)
  void chrome.storage.session.remove(['tab:' + tabId, 'flow:' + tabId])
  const id = returnScriptId(tabId)
  void chrome.scripting.getRegisteredContentScripts({ ids: [id] }).then(scripts => {
    if (scripts.length) return chrome.scripting.unregisterContentScripts({ ids: [id] })
  })
})

async function handle(message, sender) {
  if (message.type === 'pair' && sender.url === chrome.runtime.getURL('settings.html')) {
    const port = message.port ?? defaultPort
    await helper(message.key, { type: 'ping' }, port)
    await chrome.storage.local.set({ [setting]: message.key, helperPort: port })
    return
  }
  const origin = localOrigin(sender.url)
  const tabId = sender.tab?.id
  const key = 'tab:' + tabId
  const flowKey = 'flow:' + tabId
  const paired = await chrome.storage.session.get([key, flowKey])
  const grant = paired[key]
  if (!origin || origin !== grant?.origin || !grant.binding ||
      localOrigin(sender.tab?.url) !== origin || sender.documentLifecycle !== 'active') throw Error('Tab is not attached')
  if (message.type === 'resumeAttachment' && sender.frameId === 0 && sender.documentId) {
    return mountInspector(sender, grant).catch(async error => { await failed(tabId, error); throw error })
  }
  const shell = new URL(sender.url).pathname === flowPath
  if (message.type === 'attachFlowFrame' && sender.frameId > 0 && sender.documentId &&
      new URL(sender.tab.url).pathname === flowPath) {
    return queueFlowAttachment(tabId, origin, sender.documentId)
  }
  const authorizedChild = sender.documentId && sender.documentId === paired[flowKey] &&
    sender.documentLifecycle === 'active' && sender.tab.url && new URL(sender.tab.url).pathname === flowPath
  if (shell || (sender.frameId !== 0 && !authorizedChild)) {
    throw Error('Document is not attached')
  }
  if (message.type === 'complete') throw Error('Completion requires the local helper command')
  if (message.type === 'saveEvidence') throw Error('Evidence must come from the browser capture')
  if (message.type === 'captureEditEvidence') {
    const { id, route } = message
    const authorization = pendingCaptures.get(tabId)
    if (!authorization || authorization.documentId !== sender.documentId ||
        authorization.id !== id || authorization.route !== route) return
    pendingCaptures.delete(tabId)
    const image = await captureEditEvidence(sender, id)
    if (image) await call({ type: 'saveEvidence', origin, expectedBindingId: grant.binding, id, route, image })
    return
  }
  if (message.type === 'inspectComponent' || message.type === 'previewComponentSlot') {
    const { type, id, slotId, before, requested, route } = message
    if (!sender.documentId || typeof id !== 'string' || id.length > 120 ||
        typeof route !== 'string' || !route.startsWith('/') || route.length > 2048) return null
    const request = type === 'inspectComponent' ? { type, id, route } : { type, id, route, slotId, before, requested }
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId, documentIds: [sender.documentId] }, world: 'MAIN',
      func: componentPreviewRequest, args: [request, origin],
    })
    return result
  }
  if (message.type === 'previewButtonSize') {
    const { key, before, requested, route } = message
    const choices = ['default', 'sm', 'lg', 'icon']
    if (!sender.documentId || typeof key !== 'string' || !key.trim() || key.length > 120 ||
        !choices.includes(before) || !choices.includes(requested) ||
        typeof route !== 'string' || !route.startsWith('/') || route.length > 2048) return false
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: sender.tab.id, documentIds: [sender.documentId] },
      world: 'MAIN',
      func: previewButtonSize,
      args: [key, before, requested, route, origin],
    })
    return result === true
  }
  const result = await call({ ...message, origin, expectedBindingId: grant.binding })
  if (['save', 'saveTextStyle', 'saveSharedPadding', 'savePairedPadding'].includes(message.type)) {
    pendingCaptures.delete(tabId)
    if (result?.visualEvidence === true && sender.documentId) {
      const { id, route } = message.record ?? message.records[0]
      pendingCaptures.set(tabId, { documentId: sender.documentId, id, route })
    }
  }
  return result
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message, sender).then(value => respond({ ok: true, value }), error => respond({ ok: false, error: error.message, code: error.code }))
  return true
})
