'use strict'
const fs = require('fs')
const path = require('path')
const os = require('os')
const root = process.cwd()
const jsxPath = path.join(root, 'client','src','components','LatePenaltySettings.jsx')
const cssPath = path.join(root, 'client','src','components','LatePenaltySettings.css')
const migrationSource = path.join(__dirname,'supabase','migrations','20261105214500_same_day_penalty_rate_override.sql')
const migrationTarget = path.join(root,'supabase','migrations',path.basename(migrationSource))
for (const file of [jsxPath,cssPath,migrationSource]) if (!fs.existsSync(file)) throw new Error(`File missing: ${file}`)
if (fs.existsSync(migrationTarget) && !fs.readFileSync(migrationTarget).equals(fs.readFileSync(migrationSource))) throw new Error('Existing migration differs from installer source. Nothing changed.')
const original = fs.readFileSync(jsxPath,'utf8')
let jsx = original.replace(/\r\n/g, '\n')
const cssOrig = fs.readFileSync(cssPath,'utf8')
if (jsx.includes('set_annual_penalty_rates_today') || cssOrig.includes('PHILAMLIFE PENALTY TODAY ACTION')) throw new Error('The Today feature is already installed. Nothing changed.')
function swap(oldText,newText,context){
 const hits=jsx.split(oldText).length-1
 if(hits!==1)throw new Error(`${context}: expected one matching code block, found ${hits}. Nothing changed.`)
 jsx=jsx.replace(oldText,newText)
}
swap("  const [rules, setRules] = useState([])",`  const [rules, setRules] = useState([])
  const [overrides, setOverrides] = useState([])
  const [supersededRuleIds, setSupersededRuleIds] = useState([])`, 'penalty state')
swap(`  const current = (kind) => rules.find(
    (r) => r.property_classification === kind && r.effective_from <= manilaToday()
  )`, `  const current = (kind) => {
    const today = manilaToday()
    const activeOriginal = rules.filter((r) =>
      r.property_classification === kind && r.effective_from <= today &&
      !supersededRuleIds.includes(r.id)
    )
    const activeOverrides = overrides.filter((r) =>
      r.property_classification === kind && r.effective_from <= today
    )
    return [
      ...activeOriginal.map((r) => ({ ...r, isOverride: false })),
      ...activeOverrides.map((r) => ({ ...r, isOverride: true })),
    ].sort((a, b) => b.effective_from.localeCompare(a.effective_from) ||
      Number(b.isOverride) - Number(a.isOverride))[0]
  }`, 'active penalty rate selector')
swap(`      const [rates, settings] = await Promise.all([`, `      const [rates, settings, overrideResult, supersessionResult] = await Promise.all([`, 'rate data loading')
swap(`        supabase.from('system_settings')
          .select('late_penalty_first_after_months').eq('id', 1).single(),
      ])
      if (rates.error || settings.error) throw rates.error || settings.error`, `        supabase.from('system_settings')
          .select('late_penalty_first_after_months').eq('id', 1).single(),
        supabase.from('annual_penalty_rate_overrides')
          .select('id,property_classification,effective_from,annual_rate,rule_note')
          .order('effective_from', { ascending: false }),
        supabase.from('annual_penalty_rate_supersessions').select('rule_id'),
      ])
      if (rates.error || settings.error || overrideResult.error || supersessionResult.error) {
        throw rates.error || settings.error || overrideResult.error || supersessionResult.error
      }`, 'override and supersession loading')
swap(`      setRules(rows)
      setDraft({`, `      setRules(rows)
      setOverrides(overrideResult.data || [])
      setSupersededRuleIds((supersessionResult.data || []).map((r) => r.rule_id))
      setDraft({`, 'state hydration')
swap(`  async function saveRates(event) {`, `  const todayChange = Boolean(['lot_owner', 'homeowner'].some((kind) => {
    const active = current(kind)
    const desired = Number(draft[kind])
    return active && (desired !== Number(percent(active.annual_rate)) ||
      rules.some((r) => r.property_classification === kind &&
        r.effective_from > manilaToday() && !supersededRuleIds.includes(r.id)))
  }))
  const canSaveRate = effectiveFrom === manilaToday() ? todayChange : changed

  async function saveRates(event) {`, 'today-change validation')
swap(`    if (!changed || effectiveFrom <= manilaToday() || reason.trim().length < 5 ||
        reason.trim().length > 1000) {
      setMessage({ type: 'error', text: 'Change at least one rate, choose a future Manila date and enter a reason (5–1000 characters).' })`, `    if (!canSaveRate || effectiveFrom < manilaToday() || reason.trim().length < 5 ||
        reason.trim().length > 1000) {
      setMessage({ type: 'error', text: 'Change a rate or supersede a schedule, select today or a future Manila date, and enter a reason (5–1000 characters).' })`, 'same-day form validation')
swap(`      const { error } = await supabase.rpc('set_annual_penalty_rates', {
        p_lot_owner_rate: Number((Number(draft.lot_owner) / 100).toFixed(6)),
        p_homeowner_rate: Number((Number(draft.homeowner) / 100).toFixed(6)),
        p_effective_from: effectiveFrom,
        p_reason: reason.trim(),
        p_expected_lot_rule_id: latest('lot_owner').id,
        p_expected_home_rule_id: latest('homeowner').id,
      })
      if (error) throw error
      notifySuccess('New annual penalty rates scheduled and audited.')`, `      const payload = {
        p_lot_owner_rate: Number((Number(draft.lot_owner) / 100).toFixed(6)),
        p_homeowner_rate: Number((Number(draft.homeowner) / 100).toFixed(6)),
        p_reason: reason.trim(),
        p_expected_lot_rule_id: latest('lot_owner').id,
        p_expected_home_rule_id: latest('homeowner').id,
      }
      const sameDay = effectiveFrom === manilaToday()
      const { error } = sameDay
        ? await supabase.rpc('set_annual_penalty_rates_today', payload)
        : await supabase.rpc('set_annual_penalty_rates', { ...payload, p_effective_from: effectiveFrom })
      if (error) throw error
      notifySuccess(sameDay
        ? 'Today’s annual penalty rates were applied; future schedules superseded and audited.'
        : 'New annual penalty rates scheduled and audited.')`, 'rate submission RPC')
swap(`            {latest(kind)?.effective_from > manilaToday() && (`, `            {latest(kind)?.effective_from > manilaToday() && !supersededRuleIds.includes(latest(kind).id) && (`, 'scheduled badge')
swap(`        <label className="ss-field">
          <span>Effective date (future Manila date)</span>
          <DateField value={effectiveFrom} onChange={setEffectiveFrom}
            min={shiftToday(0, 1)} max={shiftToday(0, 3650)}
            clearable={false} disabled={!canEdit || busy}
            ariaLabel="Rate effective date" />
        </label>`, `        <div className="ss-field lps-effective-field">
          <span>Effective date (Manila time)</span>
          <div className="lps-effective-date-row">
            <DateField value={effectiveFrom} onChange={setEffectiveFrom}
              min={manilaToday()} max={shiftToday(0, 3650)}
              clearable={false} disabled={!canEdit || busy}
              ariaLabel="Rate effective date" />
            <button type="button" className="lps-today-button"
              onClick={() => setEffectiveFrom(manilaToday())}
              disabled={!canEdit || busy}>Today</button>
          </div>
          {effectiveFrom === manilaToday() && <small className="lps-today-warning">
            Effective today. This supersedes existing future rate schedules for classifications being updated; the previous rules remain in the audit history.
          </small>}
        </div>`, 'effective date field')
swap(`          disabled={busy || !changed || !rateValid(draft.lot_owner) ||
            !rateValid(draft.homeowner) || effectiveFrom <= manilaToday() ||`, `          disabled={busy || !canSaveRate || !rateValid(draft.lot_owner) ||
            !rateValid(draft.homeowner) || effectiveFrom < manilaToday() ||`, 'save button disabled state')
const cssAppend=`
/* PHILAMLIFE PENALTY TODAY ACTION — keep component styles local */
.lps-effective-date-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
.lps-effective-date-row > :first-child { flex: 1 1 auto; min-width: 0; }
.lps-effective-date-row .lps-today-button { flex: 0 0 auto; align-self: stretch;
  min-height: 36px; padding: 0 12px; font: inherit; font-size: 13px; font-weight: 600;
  border: 1px solid var(--primary); border-radius: 8px; background: white;
  color: var(--primary); cursor: pointer; }
.lps-effective-date-row .lps-today-button:hover:not(:disabled) { background: rgba(20, 100, 160, .08); }
.lps-effective-date-row .lps-today-button:focus-visible { outline: 3px solid var(--primary); outline-offset: 2px; }
.lps-effective-date-row .lps-today-button:disabled { opacity: .6; cursor: not-allowed; }
.lps-effective-field .lps-today-warning { display: block; font-size: 13px; line-height: 1.45; font-weight: 400; color: var(--text-dark); }
`
// Verify no existing save/receipt/billing handlers were lost. Only this component is touched.
for(const token of ['saveMonths(event)',"supabase.rpc('set_annual_penalty_rates_today'", "supabase.rpc('set_annual_penalty_rates'",'<DateField ', 'Latest']) {
 if(token!=='Latest' && !jsx.includes(token)) throw new Error('Verification failed: '+token)
}
const backupDir = fs.mkdtempSync(path.join(os.tmpdir(),'philamlife-penalty-today-'))
fs.copyFileSync(jsxPath,path.join(backupDir,'LatePenaltySettings.jsx'))
fs.copyFileSync(cssPath,path.join(backupDir,'LatePenaltySettings.css'))
try {
 fs.writeFileSync(jsxPath,jsx,'utf8')
 fs.writeFileSync(cssPath,cssOrig.trimEnd()+'\n'+cssAppend,'utf8')
 fs.mkdirSync(path.dirname(migrationTarget),{recursive:true})
 fs.copyFileSync(migrationSource,migrationTarget)
} catch(err) {
 fs.copyFileSync(path.join(backupDir,'LatePenaltySettings.jsx'),jsxPath)
 fs.copyFileSync(path.join(backupDir,'LatePenaltySettings.css'),cssPath)
 if(fs.existsSync(migrationTarget))fs.unlinkSync(migrationTarget)
 throw err
}
console.log('Updated 2 component files and created one Supabase migration file.')
console.log('Backups:',backupDir)
console.log('Migration:',migrationTarget)
console.log('Run npm run build and npx vitest run from client before committing.')
