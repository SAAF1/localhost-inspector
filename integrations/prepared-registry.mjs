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

// Fresh per map invocation. Duplicate record IDs are ineligible even before mounting.
export function recordIdentity(proof, records, field, render) {
  const counts = new Map()
  if (Array.isArray(records)) for (const record of records) {
    const value = record?.[field]
    if (typeof value === 'string' && /^[a-zA-Z0-9_./:-]{1,70}$/.test(value))
      counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return render(record => {
    const value = record?.[field]
    return counts.get(value) === 1 ? { ...proof, value, key: 'record:'+proof.id+':'+value } : { ...proof }
  })
}

export function recordAttributes(proof, file, owner) {
  return proof?.file === file && proof.owner === owner
    ? { 'data-inspector-target': proof.key, 'data-li-record-scope': JSON.stringify(proof) } : {}
}
