const loaded = new Map()
function publish() {
  document.dispatchEvent(
    new CustomEvent('li-prepared-revisions', { detail: JSON.stringify(Object.fromEntries(loaded)) }),
  )
}
document.addEventListener('li-read-prepared-revisions', publish)
export function reportPreparedSites(revisions) {
  for (const [site, revision] of Object.entries(revisions)) loaded.set(site, revision)
  publish()
}
