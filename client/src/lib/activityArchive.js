import{fetchAll}from'./fetchAll'
import{ARCHIVE_BUCKET,MAX_ARCHIVE_BYTES,decodeArchive,readBounded}from'../../../supabase/functions/_shared/activityArchiveCodec.mjs'
export function activityMonthBounds(month){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Choose a valid activity month.')
 const[y,m]=month.split('-').map(Number)
 return{from:`${month}-01T00:00:00+08:00`,to:`${String(m===12?y+1:y).padStart(4,'0')}-${String(m===12?1:m+1).padStart(2,'0')}-01T00:00:00+08:00`}
}
async function manifests(db,month){
 const result=await fetchAll(()=>db.from('activity_log_archives').select('*').eq('period_month',month+'-01').eq('state','complete').order('created_at',{ascending:true}))
 if(result.error)throw result.error
 return result.data
}
// Postgres timestamps retain microseconds that JavaScript Date truncates.
function compareEventTime(left, right) {
 const milliseconds = Date.parse(right) - Date.parse(left)
 if (milliseconds) return milliseconds
 const subMilliseconds = (value) => Number((/\.(\d+)/.exec(value)?.[1] || '').padEnd(6, '0').slice(3, 6))
 return subMilliseconds(right) - subMilliseconds(left)
}
export function compareActivityNewest(a, b) {
 const left = String(a.id)
 const right = String(b.id)
 return compareEventTime(a.created_at, b.created_at) || right.length - left.length || right.localeCompare(left)
}
const sameEvent=(a,b)=>['user_id','action','target'].every(k=>a[k]===b[k])&&compareEventTime(a.created_at,b.created_at)===0
export async function loadActivityMonth(db,month){
 try{
  const bounds=activityMonthBounds(month)
  // Read archive indexes on BOTH sides of the live read. A concurrent cutover
  // can otherwise delete rows between an index read and the live-table read.
  const before=await manifests(db,month)
  const live=await fetchAll(()=>db.from('activity_log').select('*').gte('created_at',bounds.from).lt('created_at',bounds.to).order('created_at',{ascending:false}))
  if(live.error)throw live.error
  const after=await manifests(db,month)
  const files=[...new Map([...before,...after].map(m=>[m.id,m])).values()]
  const rows=new Map()
  for(let offset=0;offset<files.length;offset+=4){
   const groups=await Promise.all(files.slice(offset,offset+4).map(async m=>{
    const{data,error}=await db.storage.from(ARCHIVE_BUCKET).download(m.object_path)
    if(error)throw Error('Archived activity could not be downloaded. Please retry.')
    if(!data || data.size>MAX_ARCHIVE_BYTES)throw Error('Archived activity file size is invalid.')
    const bytes=await readBounded(data.stream(),MAX_ARCHIVE_BYTES)
    return decodeArchive(bytes,m)
   }))
   for(const group of groups)for(const row of group){
    const previous=rows.get(String(row.id))
    if(previous&&!sameEvent(previous,row))throw Error('Archived history has conflicting records. Please contact Admin.')
    rows.set(String(row.id),{...row,id:String(row.id),from_archive:true})
   }
  }
  for(const row of live.data){
   const previous=rows.get(String(row.id))
   if(previous&&!sameEvent(previous,row))throw Error('Activity changed during archive loading. Refresh to verify history.')
   if(!previous)rows.set(String(row.id),{...row,id:String(row.id)})
  }
  return{data:[...rows.values()].sort(compareActivityNewest),error:null}
 }catch(error){return{data:null,error}}
}
export async function archiveStatus(db){const{data,error}=await db.rpc('activity_archive_status');if(error)throw error;return data}
export async function setArchiveEnabled(db,enabled){const{error}=await db.rpc('set_activity_archive_enabled',{p_enabled:enabled,p_reader_version:1});if(error)throw error}
