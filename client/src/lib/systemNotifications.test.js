import { describe, expect, it, vi } from 'vitest'
import { fetchSystemNotifications, markAllNotificationsRead, markNotificationsRead,
  isCurrentNotification, notificationLink, popoverPosition, relativeManilaTime, unreadBadge } from './systemNotifications'
function database(responses) {
  const calls=[]
  return {calls,from:vi.fn((table)=>{
    const result=responses.shift()
    const chain={then:(resolve,reject)=>Promise.resolve(result).then(resolve,reject)}
    for(const method of ['select','is','limit','order','lte','upsert']) chain[method]=(...args)=>{calls.push([table,method,...args]);return chain}
    return chain
  })}
}
describe('system notification presentation',()=>{
  it('caps badges and permits only the shared staff route',()=>{
    expect(unreadBadge(9)).toBe('9');expect(unreadBadge(25)).toBe('9+')
    expect(notificationLink('https://example.com')).toBe('/overdue-accounts')
    expect(notificationLink('/overdue-accounts')).toBe('/overdue-accounts')
  })
  it('routes property and expense events safely and respects settings permissions',()=>{
    expect(notificationLink('/homeowners/1133','treasurer')).toBe('/homeowners/1133')
    expect(notificationLink('/expenses','secretary')).toBe('/expenses')
    expect(notificationLink('/system-settings','admin')).toBe('/system-settings')
    expect(notificationLink('/system-settings','secretary')).toBe('/activity-log')
    expect(notificationLink('/system-settings','treasurer')).toBe('/activity-log')
    expect(notificationLink('/homeowners/1133?next=https://example.com','admin')).toBe('/overdue-accounts')
  })
  it('uses elapsed time and Manila calendar dates',()=>{
    const now=Date.parse('2026-11-08T16:10:00Z')
    expect(relativeManilaTime('2026-11-08T16:09:45Z',now)).toBe('Just now')
    expect(relativeManilaTime('2026-11-08T16:05:00Z',now)).toBe('5m ago')
    expect(relativeManilaTime('2026-11-08T14:10:00Z',now)).toBe('2h ago')
    expect(relativeManilaTime('2026-11-06T16:05:00Z',now)).toBe('2d ago')
    expect(relativeManilaTime('2026-10-31T16:05:00Z',now)).toMatch(/Nov 1, 2026/)
    expect(relativeManilaTime('invalid',now)).toBe('')
  })
  it('fits both viewport edges and flips above a low anchor',()=>{
    for(const right of [30,360]) {
      const result=popoverPosition({top:8,bottom:48,right},{width:375,height:667})
      expect(result.left).toBeGreaterThanOrEqual(8)
      expect(result.left+result.width).toBeLessThanOrEqual(367)
    }
    expect(popoverPosition({top:600,bottom:640,right:350},{width:375,height:667})).toMatchObject({bottom:75})
    expect(popoverPosition({top:8,bottom:48,right:1340},{width:1366,height:768})).toMatchObject({top:56,width:400})
  })
})
describe('system notification data access',()=>{
  it('loads three rows and counts all unexpired unread notices',async()=>{
    const db=database([{data:[{id:'1',notification_reads:[]},{id:'2',notification_reads:[{notification_id:'2'}]}]},{count:35}])
    expect(await fetchSystemNotifications(db)).toMatchObject({unread:35,items:[{id:'1',read:false},{id:'2',read:true}]})
    expect(db.calls).toContainEqual(['notifications','limit',3])
    expect(db.calls).toContainEqual(['notifications','is','notification_reads',null])
  })
  it('propagates failure instead of presenting unavailable data as empty',async()=>{
    const db=database([{error:new Error('network')},{}])
    await expect(fetchSystemNotifications(db)).rejects.toThrow('network')
  })
  it('inserts only the current user’s reads and ignores duplicates',async()=>{
    const db=database([{}]);await markNotificationsRead(db,'staff',['n1'])
    expect(db.calls).toContainEqual(['notification_reads','upsert',[{notification_id:'n1',user_id:'staff'}],{onConflict:'notification_id,user_id',ignoreDuplicates:true}])
  })
  it('marks all pages beyond the visible three using one cutoff',async()=>{
    const ids=Array.from({length:200},(_,i)=>({id:String(i)}))
    const db=database([{data:ids},{},{data:[{id:'last'}]},{},{data:[]}])
    await markAllNotificationsRead(db,'staff')
    expect(db.calls.filter(call=>call[1]==='upsert')).toHaveLength(2)
    expect(new Set(db.calls.filter(call=>call[1]==='lte').map(call=>call[3])).size).toBe(1)
  })
  it('stops mark-all after a failed write',async()=>{
    const db=database([{data:[{id:'n1'}]},{error:new Error('denied')}])
    await expect(markAllNotificationsRead(db,'staff')).rejects.toThrow('denied')
    expect(db.from).toHaveBeenCalledTimes(2)
  })
})

describe('notification expiry and compact height',()=>{
 it('hides an expired notice at the exact boundary and rejects invalid expiry dates',()=>{
  const now=Date.parse('2026-12-08T10:00:00Z')
  expect(isCurrentNotification({expires_at:'2026-12-08T10:00:00Z'},now)).toBe(false)
  expect(isCurrentNotification({expires_at:'2026-12-08T10:00:01Z'},now)).toBe(true)
  expect(isCurrentNotification({expires_at:'invalid'},now)).toBe(false)
  expect(isCurrentNotification({},now)).toBe(true)
 })
 it('caps expanded content at 480 pixels on a tall desktop',()=>{
  expect(popoverPosition({top:100,bottom:140,right:1300},{width:1366,height:1080}).maxHeight).toBe(480)
 })
 it('does not display stale expired data returned during an expiry race',async()=>{
  const db=database([{data:[{id:'old',expires_at:'2000-01-01T00:00:00Z'},{id:'new',expires_at:'2099-01-01T00:00:00Z'}]},{count:1}])
  expect((await fetchSystemNotifications(db)).items.map(x=>x.id)).toEqual(['new'])
 })
})
