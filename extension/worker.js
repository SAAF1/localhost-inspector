import { inspectorModules } from './inspector-modules.js'
import { dockFlowInspector, flowPath, isFlowChild, watchFlowFrame } from './flow-attachment.js'
import { componentPreviewRequest, previewButtonSize } from './component-preview.js'
import { captureEditEvidence } from './capture-evidence.js'

const endpoint = 'http://127.0.0.1:5188/inspector'
const setting = 'helperKey'
const pendingCaptures = new Map()
const flowAttachments = new Map()

async function helper(key, request) {
  if (!key) throw Error('Pair the local helper in extension settings')
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + key },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(4500),
  })
  const data = await response.json()
  if (!response.ok) throw Object.assign(Error(data.error), { code: data.code })
  return data.value
}

async function call(request) {
  return helper((await chrome.storage.local.get(setting))[setting], request)
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

async function attach(tabId, origin) {
  await call({ type: 'check', origin })
  const tab = await chrome.tabs.get(tabId)
  if (localOrigin(tab.url) !== origin) return
  await chrome.storage.session.set({ ['tab:' + tabId]: origin })
  await mountInspector(tabId, origin)
}

async function mountInspector(tabId, origin) {
  const tab = await chrome.tabs.get(tabId)
  if (localOrigin(tab.url) !== origin) return
  pendingCaptures.delete(tabId)
  if (new URL(tab.url).pathname === flowPath) {
    await chrome.scripting.executeScript({ target: { tabId }, func: watchFlowFrame })
  } else {
    await chrome.storage.session.remove('flow:' + tabId)
    await inject({ tabId })
  }
  await chrome.action.setBadgeText({ tabId, text: '' })
  await chrome.action.setTitle({ tabId, title: 'Attach Localhost Inspector' })
}

function queueFlowAttachment(tabId, origin) {
  const previous = flowAttachments.get(tabId) ?? Promise.resolve()
  const active = previous.catch(() => {}).then(() => attachFlowFrame(tabId, origin))
  flowAttachments.set(tabId, active)
  return active.finally(() => {
    if (flowAttachments.get(tabId) === active) flowAttachments.delete(tabId)
  })
}

async function attachFlowFrame(tabId, origin) {
  const tab = await chrome.tabs.get(tabId)
  if (localOrigin(tab.url) !== origin || new URL(tab.url).pathname !== flowPath) return
  const key = 'flow:' + tabId
  const frames = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true }, func: isFlowChild, args: [flowPath],
  })
  const child = frames.find(frame => frame.result && frame.documentId)
  if (!child) return
  const target = { tabId, documentIds: [child.documentId] }
  const [{ result: childOrigin }] = await chrome.scripting.executeScript({ target, func: () => location.origin })
  if (childOrigin !== origin) return
  await chrome.storage.session.set({ [key]: child.documentId })
  await chrome.scripting.executeScript({ target, func: dockFlowInspector })
  await inject(target)
  await chrome.scripting.executeScript({ target, func: async () => { await window.phaseAInspectorReady } })
  return child.documentId
}

async function failed(tabId, error) {
  await chrome.action.setBadgeText({ tabId, text: '!' })
  await chrome.action.setTitle({ tabId, title: error.message })
}

chrome.action.onClicked.addListener(tab => {
  const origin = localOrigin(tab.url)
  if (origin) void attach(tab.id, origin).catch(error => failed(tab.id, error))
})
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status !== 'complete') return
  void (async () => {
    const key = 'tab:' + tabId
    const saved = (await chrome.storage.session.get(key))[key]
    if (!saved) return
    if (localOrigin(tab.url) !== saved) {
      pendingCaptures.delete(tabId)
      await chrome.storage.session.remove([key, 'flow:' + tabId])
      return
    }
    await mountInspector(tabId, saved)
  })().catch(error => failed(tabId, error))
})
chrome.tabs.onRemoved.addListener(tabId => {
  pendingCaptures.delete(tabId)
  void chrome.storage.session.remove(['tab:' + tabId, 'flow:' + tabId])
})

async function handle(message, sender) {
  if (message.type === 'pair' && sender.url === chrome.runtime.getURL('settings.html')) {
    await helper(message.key, { type: 'ping' })
    await chrome.storage.local.set({ [setting]: message.key })
    return
  }
  const origin = localOrigin(sender.url)
  const tabId = sender.tab?.id
  const key = 'tab:' + tabId
  const flowKey = 'flow:' + tabId
  const paired = await chrome.storage.session.get([key, flowKey])
  if (!origin || origin !== paired[key]) throw Error('Tab is not attached')
  const shell = new URL(sender.url).pathname === flowPath
  if (message.type === 'attachFlowFrame' && sender.frameId === 0 && shell) {
    return queueFlowAttachment(tabId, origin)
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
    if (image) await call({ type: 'saveEvidence', origin, id, route, image })
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
  const result = await call({ ...message, origin })
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
