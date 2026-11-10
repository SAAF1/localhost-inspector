window.phaseABridge = async (message) => {
  const result = await chrome.runtime.sendMessage(message)
  if (!result?.ok) throw Error(result?.error ?? 'The editor could not save')
  return result.value
}
