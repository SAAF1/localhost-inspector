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
  if (!response.ok) throw Error(data.error)
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
    'ui/resizing.js', 'ui/layout.js', 'ui/sections.js', 'ui/panel.js', 'inspector.js',
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
  return call({ ...message, origin })
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  handle(message, sender).then(value => respond({ ok: true, value }), error => respond({ ok: false, error: error.message }))
  return true
})
