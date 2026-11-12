// Manual download of browser-local grievance records before migration.
// Contains private complaints: store the resulting file securely.
export function downloadGrievanceBackup(cases) {
  if (!Array.isArray(cases) || cases.length === 0) return false
  const data = { format: 'philamlife-grievances-local-backup', version: 1,
    exportedAt: new Date().toISOString(), count: cases.length, cases }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `philamlife-grievances-backup-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(link)
  try { link.click() } finally {
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }
  return true
}
