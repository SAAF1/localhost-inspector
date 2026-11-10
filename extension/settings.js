const input = document.querySelector('#key')
document.querySelector('#connect').onclick = async () => {
  const result = await chrome.runtime.sendMessage({ type: 'pair', key: input.value })
  document.querySelector('#result').textContent = result.ok ? 'Connected' : result.error
  if (result.ok) input.value = ''
}
