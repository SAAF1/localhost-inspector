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
// A visible projection must contain the actual objects in the complete local
// data set. Compare serialized JSON as loaded, never infer membership from a
// position or a displayed name. An unavailable source simply omits the key.
function publicRecordKeys(proof, records, field, backing, entries) {
  const keys = new Map()
  if (!Array.isArray(backing) || !Array.isArray(records) || backing.length !== entries.length ||
      records.length > backing.length || new Set(records).size !== records.length) return keys
  try {
    if (new URL(proof.resource, document.baseURI).href !== new URL(proof.resource, location.origin + '/').href) return keys
    const rows = new Map(entries.map(entry => [entry.value, entry]))
    const owners = new Map()
    for (const record of backing) {
      const value = record?.[field], entry = rows.get(value)
      if (!entry || owners.has(value) || JSON.stringify(record) !== entry.json) return keys
      owners.set(value, record)
    }
    if (!records.every(record => owners.get(record?.[field]) === record)) return keys
    for (const record of records) {
      const entry = rows.get(record[field])
      keys.set(record, { ...proof, value:entry.value, rowRevision:entry.revision, key:'record:' + proof.id + ':' + entry.revision })
    }
  } catch { keys.clear() }
  return keys
}

const activeCatalogs = new Map()
export function registerRecordCatalog(catalog, rows, hot) {
  const key = JSON.stringify(catalog)
  activeCatalogs.set(key,rows)
  hot?.dispose(() => {
    if (activeCatalogs.get(key) === rows) activeCatalogs.delete(key)
  })
}

function catalogRecordKeys(proof,records,field,backing,entries) {
  const keys = new Map()
  const domain = activeCatalogs.get(JSON.stringify(proof.catalog))
  if (!Array.isArray(domain) || domain.length !== entries.length || !Array.isArray(records) ||
      !Array.isArray(backing) || records.length > backing.length || backing.length > domain.length) return keys
  try {
    const table = new Map(entries.map(entry => [entry.value,entry]))
    const owner = new Map()
    for (const row of domain) {
      const value = row[field]
      if (owner.has(value) || table.get(value)?.json !== JSON.stringify(row)) return keys
      owner.set(value,row)
    }
    const members = new Map()
    for (const item of backing) {
      const value = item[field], row = owner.get(value)
      if (!row || members.has(value) || !Object.keys(row).every(key => Object.hasOwn(item,key) &&
          JSON.stringify(item[key]) === JSON.stringify(row[key]))) return keys
      members.set(value,item)
    }
    if (new Set(records).size !== records.length || !records.every(item => members.get(item[field]) === item)) return keys
    for (const item of records) {
      const entry = table.get(item[field])
      keys.set(item,{...proof,value:entry.value,rowRevision:entry.revision,key:'record:'+proof.id+':'+entry.revision})
    }
  } catch { keys.clear() }
  return keys
}

export function recordIdentity(proof, records, field, render, backing = records, entries) {
  if (proof.resource || proof.catalog) {
    const keys = proof.catalog ? catalogRecordKeys(proof,records,field,backing,entries) :
      publicRecordKeys(proof, records, field, backing, entries)
    return render(record => JSON.stringify(keys.get(record) ?? proof))
  }
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
