import React,{useCallback,useEffect,useState}from'react'
import{supabase}from'../lib/supabaseClient'
import{archiveStatus,setArchiveEnabled}from'../lib/activityArchive'
import{useConfirm}from'./ConfirmDialog'
import'./ActivityArchiveStatus.css'
const errors={storage_near_limit:'File storage is nearly full. Older activity remains in the database.',unknown_storage_size:'Storage usage could not be verified. Older activity remains in the database.',oversized_event:'A large activity entry needs Admin review. Its original record was retained.',storage_check_failed:'Archive storage verification failed. Original activity remains available.'}
export default function ActivityArchiveStatus({onChanged}){
 const confirm=useConfirm(),[status,setStatus]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
 const refresh=useCallback(async()=>{try{setStatus(await archiveStatus(supabase));setError('')}catch{setError('Archive status is unavailable. Historical records must be verified before cleanup.')}},[])
 useEffect(()=>{void refresh();const timer=window.setInterval(refresh,30000);window.addEventListener('focus',refresh);return()=>{window.clearInterval(timer);window.removeEventListener('focus',refresh)}},[refresh])
 async function toggle(){
  const next=!status.enabled
  const ok=await confirm({title:next?'Enable verified activity archiving?':'Pause automatic archiving?',message:next?'Keep the current and previous calendar months here. Older activity will remain searchable in private archives. Source logs are removed only after archive verification.':'Existing activity and archives remain available. Automatic transfers will pause.',confirmLabel:next?'Enable archiving':'Pause archiving',cancelLabel:'Cancel'})
  if(!ok)return
  setBusy(true);try{await setArchiveEnabled(supabase,next);await refresh();onChanged?.()}catch(e){setError(e.message||'Archive preference could not be saved.')}finally{setBusy(false)}
 }
 async function prepare(){setBusy(true);try{const{error}=await supabase.rpc('prepare_activity_archives');if(error)throw error;await refresh()}catch(e){setError(e.message||'Archive storage could not be checked.')}finally{setBusy(false)}}
 return <section className="activity-archive-status" aria-label="Activity history preservation">
 <div><strong>{status?.enabled?'Verified activity archiving enabled':'Activity history preservation'}</strong><p>{status?.enabled?'The current and previous calendar months stay here. Choose an older month to search verified archives.':'Original activity remains in the database until verified archiving is enabled.'}</p>
 {status&&<small>{Number(status.archived_records||0).toLocaleString('en-PH')} archived records · {Number(status.pending_records||0).toLocaleString('en-PH')} older records awaiting archive</small>}
 {status?.last_error&&<p role="status">{errors[status.last_error]||'An archive transfer needs another attempt. Unconfirmed original records were retained.'}</p>}
 {error&&<p role="alert">{error}</p>}</div>
 <div className="activity-archive-actions"><button type="button" disabled={busy} onClick={refresh}>Refresh archive status</button>
 {status?.can_manage&&status.installed&&(!status.storage_ready?<button type="button" disabled={busy} onClick={prepare}>Check private archive storage</button>:<button type="button" disabled={busy} onClick={toggle}>{status.enabled?'Pause archiving':'Enable verified archiving'}</button>)}</div>
 </section>
}
