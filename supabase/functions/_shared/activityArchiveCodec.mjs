// Pure browser/Deno/Node codec. Contains no credentials or platform dependencies.
export const ARCHIVE_BUCKET='activity-log-archives'
export const MAX_ARCHIVE_BYTES=5000000
export const MAX_RAW_BYTES=2000000
const utf8=new TextEncoder()
export async function sha256(bytes){
 const digest=await crypto.subtle.digest('SHA-256',bytes)
 return Array.from(new Uint8Array(digest),n=>n.toString(16).padStart(2,'0')).join('')
}
export async function readBounded(stream,limit){
 const reader=stream.getReader(),parts=[];let size=0
 try{for(;;){const{value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw Error('Archive exceeds its verified size limit.');parts.push(value)}}
 catch(error){await reader.cancel().catch(()=>{});throw error}finally{reader.releaseLock()}
 const output=new Uint8Array(size);let offset=0;for(const part of parts){output.set(part,offset);offset+=part.byteLength}return output
}
export function validateManifest(m){
 if(!m || !/^[0-9a-f-]{36}$/.test(m.id||'') || !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(m.period_month||'') ||
 m.object_path!==`${m.period_month.slice(0,7)}/${m.id}.json.gz` || !/^[0-9a-f]{64}$/.test(m.raw_sha256||'') ||
 !Number.isInteger(m.raw_bytes) || m.raw_bytes<1 || m.raw_bytes>MAX_RAW_BYTES ||
 !Number.isInteger(m.row_count) || m.row_count<1 || m.row_count>500)throw Error('Archive index is invalid.')
}
export function validateEnvelope(value,m){
 validateManifest(m)
 if(value?.version!==1 || value.archive_id!==m.id || value.month!==m.period_month.slice(0,7) || !Array.isArray(value.rows) || value.rows.length!==m.row_count)throw Error('Archive record count or period does not match its index.')
 const ids=new Set()
 const month=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Manila',year:'numeric',month:'2-digit'})
 for(const row of value.rows){
  if(!row || !/^[1-9]\d*$/.test(String(row.id)) || ids.has(String(row.id)) || typeof row.action!=='string' || typeof row.target!=='string' ||
   typeof row.user_id!=='string' || !Number.isFinite(Date.parse(row.created_at)))throw Error('Archive contains an invalid or repeated activity record.')
  const parts=Object.fromEntries(month.formatToParts(new Date(row.created_at)).map(p=>[p.type,p.value]))
  if(`${parts.year}-${parts.month}`!==value.month)throw Error('Archive contains a record from another month.')
  ids.add(String(row.id))
 }
 return value.rows
}
export async function encodeArchive(payload,m){
 validateManifest(m)
 const raw=utf8.encode(payload)
 if(raw.byteLength!==m.raw_bytes || await sha256(raw)!==m.raw_sha256)throw Error('Archive source checksum does not match.')
 validateEnvelope(JSON.parse(payload),m)
 return readBounded(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip')),MAX_ARCHIVE_BYTES)
}
export async function decodeArchive(bytes,m,{verifyStored=true}={}){
 validateManifest(m)
 if(!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength>MAX_ARCHIVE_BYTES)throw Error('Archive file size is invalid.')
 if(verifyStored && (m.stored_bytes!==bytes.byteLength || !/^[0-9a-f]{64}$/.test(m.stored_sha256||'') || await sha256(bytes)!==m.stored_sha256))throw Error('Archive file checksum does not match. History could not be verified.')
 const raw=await readBounded(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')),Math.min(m.raw_bytes,MAX_RAW_BYTES))
 if(raw.byteLength!==m.raw_bytes || await sha256(raw)!==m.raw_sha256)throw Error('Archive contents could not be verified.')
 return validateEnvelope(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)),m)
}
