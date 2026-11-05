'use strict'
const fs = require('fs')
const path = require('path')
const os = require('os')
const root = process.cwd()
const jsxPath = path.join(root, 'client', 'src', 'pages', 'SystemSettingsPage.jsx')
const cssPath = path.join(root, 'client', 'src', 'pages', 'SystemSettingsPage.css')
const cssExtraPath = path.join(__dirname, 'settings-polish.css')
for (const f of [jsxPath, cssPath, cssExtraPath]) if (!fs.existsSync(f)) throw new Error(`Missing file: ${f}. Run from the PHILAMLIFE repository root.`)
const origJsx = fs.readFileSync(jsxPath, 'utf8')
const origCss = fs.readFileSync(cssPath, 'utf8')
if (origJsx.includes('ss-general-polish') || origCss.includes('PHILAMLIFE GENERAL SETTINGS POLISH v1')) {
  throw new Error('Settings polish appears already installed. No changes made.')
}
const oldStart = "      {activeTab === 'general' && <div className=\"ss-card-grid\">"
if (origJsx.split(oldStart).length !== 2) throw new Error('Expected General tab container not found exactly once. No changes made.')
const penaltyPattern = /        <SettingsCard className="ss-penalty-card" title="Annual Penalty Rates"[\s\S]*?\n        <\/SettingsCard>\n/
const matched = origJsx.match(penaltyPattern)
if (!matched) throw new Error('Annual Penalty Rates card not found. No changes made.')
const penBlock = matched[0]
let jsx = origJsx.replace(oldStart, "      {activeTab === 'general' && <div className=\"ss-card-grid ss-general-grid\">")
jsx = jsx.replace(penBlock, '')
const prefAnchor = `          <SelectField label="Date Format" value={settings.date_format} onChange={(v) => update('date_format', v)} options={['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'].map((v) => [v, v])} />\n        </SettingsCard>\n`
if (jsx.split(prefAnchor).length !== 2) throw new Error('System preferences end marker changed. No changes made.')
jsx = jsx.replace(prefAnchor, prefAnchor + penBlock)
// Scope all new rules to the General tab; Security and Backup stay unchanged.
const returnAnchor = '    <div className="ss-page">\n      <header className="ss-header">'
if (jsx.split(returnAnchor).length !== 2) throw new Error('Settings page wrapper changed. No changes made.')
jsx = jsx.replace(returnAnchor, '    <div className={`ss-page${activeTab === \'general\' ? \' ss-general-polish\' : \'\'}`}>\n      <header className="ss-header">')
// Structural checks: no fields, handlers, or saved attributes changed.
for (const marker of ['<PricePerSqmForm ', '<LatePenaltySettings ', 'onClick={saveSettings}', "onChange={(v) => update('billing_day', v)}", "onChange={(v) => update('date_format', v)}"]) {
  if (origJsx.split(marker).length !== jsx.split(marker).length) throw new Error('Structural validation failed: '+marker)
}
const cssBlock = fs.readFileSync(cssExtraPath, 'utf8')
const outCss = origCss.trimEnd() + '\n\n' + cssBlock + '\n'
const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'philamlife-settings-polish-'))
fs.copyFileSync(jsxPath, path.join(backup, 'SystemSettingsPage.jsx'))
fs.copyFileSync(cssPath, path.join(backup, 'SystemSettingsPage.css'))
try {
  fs.writeFileSync(jsxPath, jsx)
  fs.writeFileSync(cssPath, outCss)
} catch (err) {
  fs.copyFileSync(path.join(backup, 'SystemSettingsPage.jsx'), jsxPath)
  fs.copyFileSync(path.join(backup, 'SystemSettingsPage.css'), cssPath)
  throw err
}
console.log('Updated exactly 2 files: SystemSettingsPage.jsx, SystemSettingsPage.css')
console.log('Backups: ' + backup)
console.log('From client: npm run build; npx vitest run')
