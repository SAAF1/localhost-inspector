// An experiment for opt-in React development builds. Read only actual host,
// key and state relationships. No record values or app props are modified.
const own = (object,key) => Object.getOwnPropertyDescriptor(object,key)?.value
const plain = value => value && (Array.isArray(value) || Object.getPrototypeOf(value)===Object.prototype ||
  Object.getPrototypeOf(value)===null)
const scalar = value => (typeof value==='string' && value.trim() && value.length<=70) || Number.isSafeInteger(value)

function witness(record,field,text) {
  const strings=Object.keys(record).filter(key=>key!==field && typeof own(record,key)==='string' &&
    own(record,key).trim().length>=2 && text.includes(own(record,key).trim())).sort()
  if(!strings.length)return
  const values=strings.map(key=>[key,own(record,key)])
  return JSON.stringify(values).length<=4096 ? values : undefined
}

function inspectMembership(root,rows,field) {
  const seen=new Set(),byKey=new Map(),counts=new Map()
  const work=[[root,0]]
  while(work.length){
    const [object,depth]=work.pop()
    if(!plain(object))continue
    if(rows.has(object))counts.set(object,(counts.get(object)??0)+1)
    if(seen.has(object))continue
    if(depth>12 || seen.size>=512)return
    seen.add(object)
    if(!Array.isArray(object)){
      const value=own(object,field)
      if(scalar(value)){
        const key=String(value)
        if(byKey.has(key))return
        byKey.set(key,object)
      }
    }
    const names=Object.keys(object)
    if(names.length>256)return
    for(const key of names){
      const child=own(object,key)
      if(child && typeof child==='object')work.push([child,depth+1])
    }
  }
  if(![...rows].every(row=>counts.get(row)===1 && byKey.get(String(own(row,field)))===row))return
  return byKey
}

function painted(node){
  if(!node.isConnected || !node.getClientRects().length)return false
  const css=getComputedStyle(node)
  const clear=c=>c==='transparent'||c==='rgba(0, 0, 0, 0)'
  return !clear(css.backgroundColor) || css.backgroundImage!=='none' || css.boxShadow!=='none' ||
    ['Top','Right','Bottom','Left'].some(side=>parseFloat(css['border'+side+'Width'])>0 &&
      !clear(css['border'+side+'Color'])) || ['hidden','clip'].includes(css.overflow)
}

export function installRecordContracts({currentFiber,recordCalls,stateOrigins,moduleRevisions,renderOrigins}){
  function keyed(node){
    const fiber=currentFiber(node)
    if(!fiber || fiber.stateNode!==node)return
    let count=0
    for(let f=fiber;f && count++<96;f=f.return){
      if(f.key==null)continue
      const binding=recordCalls.get(f.memoizedProps)
      if(binding && String(own(binding.record,binding.site.field))===String(f.key))return {...binding,fiber:f}
      return
    }
  }
  function renderPath(node, anchor) {
    const path = []
    for (let fiber = currentFiber(node); fiber; fiber = fiber.return) {
      // Host elements and fragments introduce no additional component source.
      if (typeof fiber.type !== 'string' && fiber.tag !== 7) {
        const site = renderOrigins.get(fiber.elementType) ?? renderOrigins.get(fiber.type)
        if (!site || !moduleRevisions.has(site.file) || path.length >= 12) return
        path.push({...site, revision: moduleRevisions.get(site.file)})
      }
      if (fiber === anchor) return path
    }
  }
  function inspect(node,expected){
    if(!painted(node))return
    const raw=node.getAttribute('data-li-source-use')
    if(!raw)return
    const part=JSON.parse(raw),binding=keyed(node)
    if(!binding || !moduleRevisions.has(part.file))return
    const {site:anchor,record}=binding,field=anchor.field,value=own(record,field)
    if(!scalar(value) || (expected && (expected.value!==value || expected.anchor!==anchor.id)))return
    const hosts=document.querySelectorAll('[data-li-source-use="'+CSS.escape(raw)+'"]')
    if(hosts.length>128)return
    const peers=new Map()
    for(const host of hosts){
      const other=keyed(host)
      if(other?.site.id!==anchor.id)continue
      const id=own(other.record,field)
      if(!scalar(id) || peers.has(String(id)))return
      peers.set(String(id),other.record)
    }
    if(peers.get(String(value))!==record || (!expected && peers.size<2))return
    const fields=witness(record,field,node.textContent)
    if(!fields)return
    const members=new Set(peers.values()),matched=new Set()
    let authority
    for(let f=binding.fiber,steps=0;f && steps++<96;f=f.return){
      for(let h=f.memoizedState,i=0;h && i++<64;h=h.next){
        const root=h.memoizedState,site=root && stateOrigins.get(root)
        if(!site || matched.has(root))continue
        const table=inspectMembership(root,members,field)
        if(!table)continue
        if([...table.values()].some(other=>other!==record && fields.every(([k,v])=>own(other,k)===v)))return
        matched.add(root);authority=site
        if(matched.size>1)return
      }
    }
    const path = renderPath(node, binding.fiber)
    if(!authority || !path)return
    return {kind:'state-record',operation:'border-radius',value,field,witness:JSON.stringify(fields),members:peers.size,renderPath:path,
      part:{...part,revision:moduleRevisions.get(part.file)},
      anchor:{id:anchor.id,owner:anchor.owner,file:anchor.file,revision:moduleRevisions.get(anchor.file)},
      authority:{...authority,revision:moduleRevisions.get(authority.file)}}
  }
  document.addEventListener('li-read-record-contract',event=>{
    const node=event.target
    if(!(node instanceof HTMLElement))return
    let proof
    try{
      const expected=event.detail?.mode==='restore' ? event.detail : null
      proof=inspect(node,expected)
      if(!proof && !expected && keyed(node))proof={unavailable:true}
    }catch{/* Optional preparation must preserve application behavior. */}
    node.dispatchEvent(new CustomEvent('li-record-contract',{detail:JSON.stringify(proof??null)}))
  })
}

