const input = document.querySelector('#key')
const port = document.querySelector('#port')
chrome.storage.local.get('helperPort').then(pair => { if (pair.helperPort) port.value = String(pair.helperPort) })
document.querySelector('#connect').onclick = async () => {
  const result = await chrome.runtime.sendMessage({ type: 'pair', key: input.value, port: Number(port.value) })
  document.querySelector('#result').textContent = result.ok ? 'Connected' : result.error
  if (result.ok) input.value = ''
}
