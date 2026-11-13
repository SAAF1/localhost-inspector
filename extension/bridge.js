window.phaseABridge = async (message) => {
  const result = await chrome.runtime.sendMessage(message)
  if (!result?.ok) throw Object.assign(Error(result?.error ?? 'The editor could not save'), { code: result?.code })
  return result.value
}
