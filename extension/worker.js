const endpoint = 'http://127.0.0.1:5188/inspector'
const setting = 'helperKey'

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

async function inject(tabId) {
  const [{ result: mounted }] = await chrome.scripting.executeScript({
    target: { tabId }, func: () => Boolean(window.phaseAInspectorReady),
  })
  if (!mounted) {await chrome.scripting.executeScript({ target: { tabId }, files: [
    'bridge.js', 'ui/font.js', 'ui/tokens.js', 'ui/styles.js', 'ui/icons.js', 'ui/dom.js',
    'ui/policy.js', 'ui/menu.js', 'ui/controls.js', 'ui/padding.js',
    'ui/resizing.js', 'ui/alignment-settings.js', 'ui/spacing-gap.js', 'ui/alignment.js', 'ui/layout.js', 'ui/text-targets.js', 'ui/text-style-values.js', 'ui/field-view.js',
    'ui/solid-color-picker.js', 'ui/create-definition.js', 'ui/create-color-variable.js', 'ui/create-text-style.js', 'ui/color-variable-picker.js', 'ui/color-bindings.js', 'ui/text-style-control.js', 'ui/sections.js', 'ui/panel-styles.js', 'ui/tooltip.js',
    'ui/panel.js', 'ui/revert-dialog.js', 'selection.js', 'shortcuts.js', 'preview-recovery.js', 'button-size.js', 'inspector.js',
  ] })}
}

async function attach(tabId, origin) {
  await call({ type: 'check', origin })
  await chrome.storage.session.set({ ['tab:' + tabId]: origin })
  await inject(tabId)
  await chrome.action.setBadgeText({ tabId, text: '' })
}

async function failed(tabId, error) {
  await chrome.storage.session.remove('tab:' + tabId)
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
      await chrome.storage.session.remove(key)
      return
    }
    await attach(tabId, saved)
  })().catch(error => failed(tabId, error))
})
chrome.tabs.onRemoved.addListener(tabId => { void chrome.storage.session.remove('tab:' + tabId) })

async function previewButtonSize(key, before, requested, route, origin) {
  // Fixed operation in the app world. No source path, extension data or general
  // command dispatcher is exposed to the app.
  const getRoute = () => location.pathname + location.search + (/^#!?\//.test(location.hash) ? location.hash : '')
  if (location.origin !== origin || getRoute() !== route) return false
  const registration = window.localhostInspectorButtonSize
  const selector = '[data-inspector-target="' + CSS.escape(key) + '"]'
  const node = document.querySelector(selector)
  const ownsNode = () => node?.isConnected && node === registration?.node && node.localName === 'button' &&
    node.getAttribute('data-slot') === 'button' && node.getAttribute('data-inspector-target') === key &&
    window.localhostInspectorButtonSize === registration
  const valid = () => ownsNode() && getRoute() === route
  const size = () => node.getAttribute('data-inspector-button-size')
  const unique = () => document.querySelectorAll(selector).length === 1
  if (!valid() || !unique() || typeof registration.setSize !== 'function' || size() !== before) return false
  if (before === requested) return true
  // React must acknowledge through the selected Button's committed DOM.
  registration.setSize(requested)
  const waitForSize = async value => {
    const deadline = performance.now() + 450
    while (valid() && size() !== value && performance.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 16))
    }
    return valid() && size() === value
  }
  if (await waitForSize(requested) && unique()) return true
  if (ownsNode() && (size() === before || size() === requested)) {
    registration.setSize(before)
    await waitForSize(before)
  }
  return false
}

async function handle(message, sender) {
  if (message.type === 'pair' && sender.url === chrome.runtime.getURL('settings.html')) {
    await helper(message.key, { type: 'ping' })
    await chrome.storage.local.set({ [setting]: message.key })
    return
  }
  const origin = localOrigin(sender.url)
  const key = 'tab:' + sender.tab?.id
  if (!origin || sender.frameId !== 0 || origin !== (await chrome.storage.session.get(key))[key]) {
    throw Error('Tab is not attached')
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
  return call({ ...message, origin })
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message, sender).then(value => respond({ ok: true, value }), error => respond({ ok: false, error: error.message, code: error.code }))
  return true
})
