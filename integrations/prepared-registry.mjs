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
function recordCounts(records, field) {
  const counts = new Map()
  if (Array.isArray(records))
    for (const record of records) {
      const value = record?.[field]
      if (typeof value === 'string' && value.trim() && /^[^\x00-\x1F\x7F]{1,70}$/u.test(value))
        counts.set(value, (counts.get(value) ?? 0) + 1)
    }
  return counts
}
export function recordIdentity(proof, records, field, render, backing = records) {
  const counts = recordCounts(records, field)
  const owners = backing === records ? counts : recordCounts(backing, field)
  const members = backing !== records && new Set(Array.isArray(backing) ? backing : [])
  return render((record) => {
    const value = record?.[field]
    const unique = counts.get(value) === 1 && owners.get(value) === 1 && (!members || members.has(record))
    return JSON.stringify(unique ? { ...proof, value, key: 'record:' + proof.id + ':' + value } : proof)
  })
}

export function recordAttributes(wire, file, owner) {
  if (typeof wire !== 'string') return {}
  let proof
  try {
    proof = JSON.parse(wire)
  } catch {
    return {}
  }
  return proof?.file === file && proof.owner === owner
    ? { 'data-inspector-target': proof.key, 'data-li-record-scope': JSON.stringify(proof) }
    : {}
}
