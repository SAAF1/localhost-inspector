// A separate tab can register the same candidate origin. Coalesce its wakeup.
if (!window.localhostInspectorResume) {
  let pending
  window.localhostInspectorResume = () => {
    if (pending) return
    pending = chrome.runtime.sendMessage({ type: 'resumeAttachment' })
      .catch(() => {}).finally(() => { pending = undefined })
  }
  window.addEventListener('pageshow', event => {
    if (event.persisted) window.localhostInspectorResume()
  })
}
window.localhostInspectorResume()
