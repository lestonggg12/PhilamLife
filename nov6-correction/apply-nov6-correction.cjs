'use strict'
// Safe follow-up patch for an ALREADY installed "Today" frontend.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = process.cwd()
const component = path.join(root, 'client/src/components/LatePenaltySettings.jsx')
const migration = path.join(root, 'supabase/migrations/20261105214500_same_day_penalty_rate_override.sql')
const source = path.join(__dirname, '20261105214500_same_day_penalty_rate_override.sql')
const files = [component, migration, source]
for (const file of files) if (!fs.existsSync(file)) throw Error(`Required file missing: ${file}`)
const originalComponent = fs.readFileSync(component, 'utf8')
const originalMigration = fs.readFileSync(migration, 'utf8')
if (!originalComponent.includes('set_annual_penalty_rates_today')) throw Error('Today frontend is not installed. No files changed.')
if (!originalMigration.includes('CREATE OR REPLACE FUNCTION public.set_annual_penalty_rates_today')) throw Error('Unexpected local SQL migration. No files changed.')
if (originalMigration.includes('r.effective_from>=v_today')) throw Error('Migration already has same-day correction. No files changed.')
const newline = originalComponent.includes('\r\n') ? '\r\n' : '\n'
let jsx = originalComponent.replace(/\r\n/g, '\n')
function swap(a, b, label) {
  const n = jsx.split(a).length - 1
  if (n !== 1) throw Error(`${label}: expected one exact match; found ${n}. No files changed.`)
  jsx = jsx.replace(a, b)
}
swap(`        r.effective_from > manilaToday() && !supersededRuleIds.includes(r.id)))`,
     `        r.effective_from >= manilaToday() && !supersededRuleIds.includes(r.id)))`, 'same-day supersession eligibility')
swap(`      const newest = (kind) => rows.find((r) => r.property_classification === kind)
      if (!newest('lot_owner') || !newest('homeowner')) {`,
`      const newest = (kind) => rows.find((r) => r.property_classification === kind)
      const superseded = new Set((supersessionResult.data || []).map((r) => r.rule_id))
      const effectiveNow = (kind) => [
        ...rows.filter((r) => r.property_classification === kind &&
          r.effective_from <= manilaToday() && !superseded.has(r.id))
          .map((r) => ({ ...r, isOverride: false })),
        ...(overrideResult.data || []).filter((r) =>
          r.property_classification === kind && r.effective_from <= manilaToday())
          .map((r) => ({ ...r, isOverride: true })),
      ].sort((a, b) => b.effective_from.localeCompare(a.effective_from) ||
        Number(b.isOverride) - Number(a.isOverride))[0]
      if (!newest('lot_owner') || !newest('homeowner')) {`, 'active rate hydration')
swap(`        lot_owner: percent(newest('lot_owner').annual_rate),
        homeowner: percent(newest('homeowner').annual_rate),`,
`        lot_owner: percent((effectiveNow('lot_owner') || newest('lot_owner')).annual_rate),
        homeowner: percent((effectiveNow('homeowner') || newest('homeowner')).annual_rate),`, 'rate defaults')
swap(`This supersedes existing future rate schedules for classifications being updated; the previous rules remain in the audit history.`,
     `A same-day change can supersede rules effective today or later. Original rules remain preserved in the audit history.`, 'date message')
swap(`Today’s annual penalty rates were applied; future schedules superseded and audited.`,
     `Today’s annual penalty rates were applied and applicable rule versions superseded with an audit record.`, 'save notification')
const edited = jsx.replace(/\n/g, newline)
const correctedSql = fs.readFileSync(source, 'utf8')
if (!correctedSql.includes('r.effective_from>=v_today') ||
    !correctedSql.includes('rate_override_id') ||
    !correctedSql.includes('pg_get_functiondef')) throw Error('Corrected migration failed verification. No files changed.')
const backup = `${migration}.before-nov6-fix.bak`
const componentBackup = `${component}.before-nov6-fix.bak`
for (const file of [backup, componentBackup]) if (fs.existsSync(file)) throw Error(`Backup already exists: ${file}. No files changed.`)
// Create backups; validate everything before changing the two live local files.
fs.copyFileSync(migration, backup, fs.constants.COPYFILE_EXCL)
fs.copyFileSync(component, componentBackup, fs.constants.COPYFILE_EXCL)
try {
  fs.writeFileSync(component, edited, 'utf8')
  fs.writeFileSync(migration, correctedSql, 'utf8')
} catch (e) {
  fs.copyFileSync(componentBackup, component)
  fs.copyFileSync(backup, migration)
  throw e
}
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16)
console.log('Applied November 6 corrections to the existing local frontend and migration.')
console.log('SQL SHA-256 prefix:', hash(migration))
console.log('Backups:', componentBackup, 'and', backup)
console.log('No production database or GitHub changes were made.')
