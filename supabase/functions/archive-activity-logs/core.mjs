import{ARCHIVE_BUCKET,MAX_ARCHIVE_BYTES,encodeArchive,decodeArchive,readBounded,sha256}from'../_shared/activityArchiveCodec.mjs'
const jsonHeaders={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:jsonHeaders})
export function createArchiveWorker({url,key,fetch:request=fetch}){
 const root=String(url||'').replace(/\/$/,'')
 const authHeaders={apikey:key,Authorization:`Bearer ${key}`}
 async function api(path,options={}){
  return request(root+path,{...options,headers:{...authHeaders,...options.headers},signal:AbortSignal.timeout(10000),redirect:'error'})
 }
 async function rpc(name,body={}){
  const r=await api('/rest/v1/rpc/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
  if(!r.ok)throw Error('Archive database request failed: '+name)
  const text=await r.text();return text?JSON.parse(text):null
 }
 async function bucket(){
  let r=await api('/storage/v1/bucket/'+ARCHIVE_BUCKET)
  let missing=r.status===404
  // Storage can return HTTP 400 with a 404 error body for a missing bucket.
  if(r.status===400){const detail=await r.json().catch(()=>({}));missing=String(detail.statusCode)==='404' || detail.message==='Bucket not found'}
  if(missing){
   const made=await api('/storage/v1/bucket',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:ARCHIVE_BUCKET,name:ARCHIVE_BUCKET,public:false,file_size_limit:MAX_ARCHIVE_BYTES,allowed_mime_types:['application/gzip']})})
   if(!made.ok && made.status!==409 && made.status!==400)throw Error('Private archive storage could not be created.')
   r=await api('/storage/v1/bucket/'+ARCHIVE_BUCKET)
  }
  if(!r.ok)throw Error('Private archive storage is unavailable.')
  const info=await r.json();if(info.public!==false)throw Error('Archive storage must remain private.')
 }
 const objectPath=path=>'/storage/v1/object/'+ARCHIVE_BUCKET+'/'+path.split('/').map(encodeURIComponent).join('/')
 async function put(path,bytes){
  const r=await api(objectPath(path),{method:'POST',headers:{'Content-Type':'application/gzip','x-upsert':'false','Cache-Control':'31536000'},body:bytes})
  if(r.ok)return
  // A previous request may have uploaded successfully before losing its response.
  if(r.status===409)return
  if(r.status===400){const detail=await r.json().catch(()=>({}));if(detail.error==='Duplicate' || detail.statusCode==='409')return}
  throw Error('upload_failed')
 }
 async function get(path){
  const r=await api(objectPath(path),{headers:{'Cache-Control':'no-cache'}})
  if(!r.ok || !r.body)throw Error('download_failed')
  return readBounded(r.body,MAX_ARCHIVE_BYTES)
 }
 async function selfTest(){
  const id=crypto.randomUUID(),month='2000-01',path=`checks/${id}.json.gz`
  const payload=JSON.stringify({version:1,archive_id:id,month,rows:[{id:'1',user_id:'00000000-0000-0000-0000-000000000001',action:'Archive storage check',target:'Synthetic storage verification; no actual activity records.',created_at:'2000-01-02T00:00:00Z'}]})
  const raw=new TextEncoder().encode(payload),m={id,period_month:month+'-01',object_path:`${month}/${id}.json.gz`,row_count:1,raw_bytes:raw.byteLength,raw_sha256:await sha256(raw)}
  let uploaded=false
  try{
   await bucket();const bytes=await encodeArchive(payload,m);await put(path,bytes);uploaded=true
   const stored=await get(path);await decodeArchive(stored,{...m,stored_bytes:stored.byteLength,stored_sha256:await sha256(stored)})
   const deleted=await api('/storage/v1/object/'+ARCHIVE_BUCKET,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:[path]})})
   if(!deleted.ok)throw Error('Synthetic archive check could not be cleaned up.')
   uploaded=false;await rpc('activity_archive_health',{p_ok:true});return response({ok:true,mode:'self_test'})
  }catch{
   if(uploaded)await api('/storage/v1/object/'+ARCHIVE_BUCKET,{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({prefixes:[path]})}).catch(()=>{})
   await rpc('activity_archive_health',{p_ok:false}).catch(()=>{})
   return response({ok:false,error:'Archive storage verification failed. Source records were retained.'},503)
  }
 }
 return async function handle(req){
  if(req.method!=='POST')return response({error:'POST required'},405)
  const token=req.headers.get('x-archive-worker-token')||''
  if(token.length<64 || token.length>256)return response({error:'Unauthorized'},401)
  if(!root || !key)return response({error:'Archive service is not configured'},503)
  try{if(await rpc('activity_archive_auth',{p_token:token})!==true)return response({error:'Unauthorized'},401)}catch{return response({error:'Archive authentication unavailable'},503)}
  let input;try{input=await req.json()}catch{return response({error:'Invalid request'},400)}
  if(input?.mode==='self_test')return selfTest()
  if(input?.mode!=='archive')return response({error:'Invalid archive mode'},400)
  let current;let removed=0
  try{
   for(let batch=0;batch<2;batch++){
    current=await rpc('activity_archive_claim')
    if(current.state!=='work')return response({ok:true,state:current.state,removed})
    await bucket()
    const m=current.manifest,bytes=await encodeArchive(current.payload,m)
    await put(m.object_path,bytes)
    const stored=await get(m.object_path),storedHash=await sha256(stored)
    await decodeArchive(stored,{...m,stored_bytes:stored.byteLength,stored_sha256:storedHash})
    const count=await rpc('activity_archive_finish',{p_archive_id:m.id,p_lease:current.lease,p_raw_sha256:m.raw_sha256,p_stored_sha256:storedHash,p_stored_bytes:stored.byteLength})
    if(count!==m.row_count)throw Error('checksum_mismatch')
    removed+=count;current=null
   }
   return response({ok:true,state:'more_may_remain',removed})
  }catch(error){
   const message=String(error?.message||'')
   const code=['upload_failed','download_failed','checksum_mismatch'].includes(message)?message:message.toLowerCase().includes('checksum')?'checksum_mismatch':'worker_error'
   if(current?.state==='work')await rpc('activity_archive_fail',{p_archive_id:current.manifest.id,p_lease:current.lease,p_code:code}).catch(()=>{})
   return response({ok:false,error:'Archive verification did not complete. Unconfirmed source records were retained.',removed},503)
  }
 }
}
