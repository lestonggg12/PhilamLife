import{describe,it,expect,vi}from'vitest'
import{sha256,encodeArchive,decodeArchive,readBounded,ARCHIVE_BUCKET}from'../../../supabase/functions/_shared/activityArchiveCodec.mjs'
import{createArchiveWorker}from'../../../supabase/functions/archive-activity-logs/core.mjs'
import{loadActivityMonth,activityMonthBounds}from'./activityArchive'
const archiveId='00000000-0000-0000-0000-000000000001'
const event={id:'9007199254740993',user_id:'00000000-0000-0000-0000-000000000002',action:'Settings Updated',target:'Complete ₱ description; line one\n日本語 '+ 'audit text '.repeat(80)+'KEEP-END',created_at:'2026-08-31T16:00:00.123456Z',archived_actor:{name:'Test Staff',role:'secretary'},custom_metadata:{kept:true}}
async function batch(rows=[event]){
 const payload=JSON.stringify({version:1,archive_id:archiveId,month:'2026-09',rows})
 const m={id:archiveId,period_month:'2026-09-01',object_path:`2026-09/${archiveId}.json.gz`,row_count:rows.length,raw_bytes:new TextEncoder().encode(payload).byteLength,raw_sha256:await sha256(new TextEncoder().encode(payload)),state:'complete'}
 const bytes=await encodeArchive(payload,m)
 return{state:'work',manifest:{...m,stored_bytes:bytes.byteLength,stored_sha256:await sha256(bytes)},lease:'00000000-0000-0000-0000-000000000003',payload,bytes}
}
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}})
function workerFixture(b,options={}){
 const calls=[],objects=new Map(),claims=[b,{state:'idle'}];let bucketCreated=!options.missingBucket
 if(options.duplicate)objects.set(b.manifest.object_path,b.bytes)
 const request=vi.fn(async(input,init={})=>{
  const url=new URL(input),name=url.pathname.split('/').at(-1),method=init.method||'GET'
  if(url.pathname.startsWith('/rest/v1/rpc/')){
   const body=JSON.parse(init.body||'{}');calls.push({name,body})
   if(name==='activity_archive_auth')return json(!options.unauthorized)
   if(name==='activity_archive_claim')return json(options.disabled?{state:'disabled'}:claims.shift()||{state:'idle'})
   if(name==='activity_archive_finish')return options.finishFails?json({error:'lease expired'},409):json(b.manifest.row_count)
   return json(null)
  }
  if(url.pathname.startsWith('/storage/v1/bucket')){
   if(method==='POST'){bucketCreated=true;return json({})}
   if(!bucketCreated)return json({statusCode:'404',message:'Bucket not found'},400)
   return json({public:!!options.publicBucket})
  }
  if(url.pathname==='/storage/v1/object/'+ARCHIVE_BUCKET&&method==='DELETE'){
   for(const key of JSON.parse(init.body).prefixes)objects.delete(key)
   return json({})
  }
  const key=decodeURIComponent(url.pathname.split('/storage/v1/object/'+ARCHIVE_BUCKET+'/')[1]||'')
  if(method==='POST'){
   expect(init.headers['x-upsert']).toBe('false')
   if(options.uploadFails)return json({error:'upload failed'},503)
   if(objects.has(key))return json({error:'Duplicate'},409)
   objects.set(key,new Uint8Array(init.body));return json({})
  }
  if(options.downloadFails)return json({error:'download failed'},503)
  const bytes=objects.get(key)
  if(!bytes)return json({error:'missing object'},404)
  if(options.corrupt){const bad=bytes.slice();bad[bad.length-1]^=1;return new Response(bad)}
  return new Response(bytes)
 })
 const handler=createArchiveWorker({url:'https://fixture.supabase.co',key:'test-server-key',fetch:request})
 const invoke=(mode='archive',token='s'.repeat(64))=>handler(new Request('https://worker.test',{method:'POST',headers:{'x-archive-worker-token':token,'Content-Type':'application/json'},body:JSON.stringify({mode})}))
 return{calls,objects,invoke,request}
}
describe('lossless archive codec',()=>{
 it('round-trips full text, actor snapshots, unknown metadata, microseconds and bigint IDs',async()=>{
  const b=await batch();expect(await decodeArchive(b.bytes,b.manifest)).toEqual([event])
 })
 it('checks the compressed-file checksum before presenting history',async()=>{
  const b=await batch();b.bytes[0]^=1;await expect(decodeArchive(b.bytes,b.manifest)).rejects.toThrow('checksum')
 })
 it('rejects the wrong raw checksum even if the stored-file checksum matches',async()=>{
  const b=await batch();await expect(decodeArchive(b.bytes,{...b.manifest,raw_sha256:'0'.repeat(64)})).rejects.toThrow('verified')
 })
 it('rejects a wrong record count',async()=>{
  const b=await batch();await expect(decodeArchive(b.bytes,{...b.manifest,row_count:2})).rejects.toThrow('count')
 })
 it('rejects repeated IDs',async()=>{await expect(batch([event,event])).rejects.toThrow('repeated')})
 it('uses Manila months across a UTC month boundary',async()=>{
  expect((await batch()).manifest.period_month).toBe('2026-09-01')
  await expect(batch([{...event,created_at:'2026-09-30T16:00:00Z'}])).rejects.toThrow('another month')
 })
 it('rejects unexpected object paths',async()=>{
  const b=await batch();await expect(decodeArchive(b.bytes,{...b.manifest,object_path:'../other-bucket/file'})).rejects.toThrow('index')
 })
 it('bounds decompression to prevent oversized data from being consumed',async()=>{
  const stream=new Blob([new Uint8Array(100)]).stream();await expect(readBounded(stream,50)).rejects.toThrow('limit')
 })
})
describe('scheduled archive worker',()=>{
 it('rejects missing credentials before making any server calls',async()=>{
  const f=workerFixture(await batch());expect((await f.invoke('archive','')).status).toBe(401);expect(f.request).not.toHaveBeenCalled()
 })
 it('rejects an incorrect scheduler token without touching archives',async()=>{
  const f=workerFixture(await batch(),{unauthorized:true});expect((await f.invoke()).status).toBe(401);expect(f.calls.map(c=>c.name)).toEqual(['activity_archive_auth'])
 })
 it('does no storage work while disabled',async()=>{
  const f=workerFixture(await batch(),{disabled:true});expect((await f.invoke()).status).toBe(200);expect(f.objects.size).toBe(0);expect(f.calls.some(c=>c.name==='activity_archive_finish')).toBe(false)
 })
 it('uploads immutably, downloads and verifies before finalization',async()=>{
  const b=await batch(),f=workerFixture(b),result=await(await f.invoke()).json()
  expect(result.removed).toBe(1)
  const finish=f.calls.find(c=>c.name==='activity_archive_finish')
  expect(finish.body).toEqual({p_archive_id:b.manifest.id,p_lease:b.lease,p_raw_sha256:b.manifest.raw_sha256,p_stored_sha256:b.manifest.stored_sha256,p_stored_bytes:b.bytes.byteLength})
 })
 it.each([{uploadFails:true},{downloadFails:true},{corrupt:true},{publicBucket:true}])('retains source records when verification cannot complete: %j',async options=>{
  const f=workerFixture(await batch(),options),result=await f.invoke()
  expect(result.status).toBe(503);expect(f.calls.some(c=>c.name==='activity_archive_finish')).toBe(false)
  expect(f.calls.some(c=>c.name==='activity_archive_fail')).toBe(true)
 })
 it('recovers an upload whose previous response was lost without overwriting it',async()=>{
  const f=workerFixture(await batch(),{duplicate:true});expect((await f.invoke()).status).toBe(200);expect(f.calls.some(c=>c.name==='activity_archive_finish')).toBe(true)
 })
 it('does not claim successful deletion if database finalization fails',async()=>{
  const f=workerFixture(await batch(),{finishFails:true}),result=await(await f.invoke()).json();expect(result.ok).toBe(false);expect(result.removed).toBe(0)
 })
 it('self-tests private upload/readback and removes only its synthetic check object',async()=>{
  const f=workerFixture(await batch());expect((await f.invoke('self_test')).status).toBe(200)
  expect(f.objects.size).toBe(0);expect(f.calls.find(c=>c.name==='activity_archive_health').body).toEqual({p_ok:true})
  expect(f.calls.some(c=>c.name==='activity_archive_claim')).toBe(false)
 })
 it('creates a missing private bucket when Storage returns HTTP 400 with a 404 error body',async()=>{
  const f=workerFixture(await batch(),{missingBucket:true});expect((await f.invoke('self_test')).status).toBe(200)
  expect(f.calls.find(c=>c.name==='activity_archive_health').body).toEqual({p_ok:true});expect(f.objects.size).toBe(0)
 })
 it('marks storage unready if self-test readback is corrupted',async()=>{
  const f=workerFixture(await batch(),{corrupt:true});expect((await f.invoke('self_test')).status).toBe(503)
  expect(f.calls.find(c=>c.name==='activity_archive_health').body).toEqual({p_ok:false});expect(f.objects.size).toBe(0)
 })
})
function readerFixture(responses,b,{missing=false}={}){
 return{from:vi.fn(()=>{const q={};for(const method of['select','eq','order','gte','lt'])q[method]=()=>q;q.range=async()=>responses.shift();return q}),storage:{from:vi.fn(()=>({download:vi.fn(async()=>missing?{error:{message:'missing'}}:{data:new Blob([b.bytes])})}))}}
}
describe('staff historical reader',()=>{
 it('selects a historical month across year rollover',()=>{expect(activityMonthBounds('2026-12')).toEqual({from:'2026-12-01T00:00:00+08:00',to:'2027-01-01T00:00:00+08:00'})})
 it('catches a manifest committed between the first index read and live read',async()=>{
  const b=await batch(),db=readerFixture([{data:[]},{data:[]},{data:[b.manifest]}],b)
  const result=await loadActivityMonth(db,'2026-09');expect(result.error).toBeNull();expect(result.data).toEqual([{...event,from_archive:true}])
 })
 it('merges a cutover overlap exactly once',async()=>{
  const b=await batch(),db=readerFixture([{data:[]},{data:[event]},{data:[b.manifest]}],b)
  const result=await loadActivityMonth(db,'2026-09');expect(result.error).toBeNull();expect(result.data).toHaveLength(1)
 })
 it('reports a missing archive as unavailable instead of showing incomplete or empty history',async()=>{
  const b=await batch(),db=readerFixture([{data:[b.manifest]},{data:[{...event,id:'2'}]},{data:[b.manifest]}],b,{missing:true})
  const result=await loadActivityMonth(db,'2026-09');expect(result.data).toBeNull();expect(result.error.message).toContain('downloaded')
 })
 it('rejects conflicts between a live row and archived evidence',async()=>{
  const b=await batch(),db=readerFixture([{data:[b.manifest]},{data:[{...event,target:'Different'}]},{data:[b.manifest]}],b)
  const result=await loadActivityMonth(db,'2026-09');expect(result.data).toBeNull();expect(result.error.message).toContain('changed')
 })
 it('does not silently stop at the API page limit',async()=>{
  const b=await batch(),rows=Array.from({length:1000},(_,i)=>({...event,id:String(i+1)})),db=readerFixture([{data:[]},{data:rows},{data:[{...event,id:'1001'}]},{data:[]}],b)
  const result=await loadActivityMonth(db,'2026-09');expect(result.error).toBeNull();expect(result.data).toHaveLength(1001)
 })
})
