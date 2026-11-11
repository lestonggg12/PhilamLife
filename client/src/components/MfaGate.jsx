import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// Staged rollout: optional first-factor enrollment, but mandatory challenge
// for users who have already enrolled TOTP.
export default function MfaGate({ children, onSignOut }) {
  const [phase, setPhase] = useState('loading')
  const [factor, setFactor] = useState(null)
  const [enrollment, setEnrollment] = useState(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const inspect = useCallback(async () => {
    setPhase('loading')
    const [levels, factors] = await Promise.all([
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.auth.mfa.listFactors(),
    ])
    if (levels.error) throw levels.error
    if (factors.error) throw factors.error
    const verified = factors.data.totp?.find(item => item.status === 'verified')
    if (verified && levels.data.currentLevel !== 'aal2') {
      setFactor(verified)
      setPhase('challenge')
    } else if (verified) {
      setPhase('ready')
    } else {
      setPhase('offer')
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    // inspect is bound to this mounted gate; do not start enrollment automatically.
    inspect().catch(() => {
      if (!cancelled) {
        setError('Unable to verify your security status. Check your connection and retry.')
        setPhase('error')
      }
    })
    return () => { cancelled = true }
  }, [inspect])

  async function startEnrollment() {
    setBusy(true)
    setError('')
    try {
      const result = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'PhilamLife staff' })
      if (result.error) throw result.error
      setEnrollment(result.data)
      setPhase('enroll')
    } catch {
      setError('Unable to start authenticator setup. Try again.')
    } finally { setBusy(false) }
  }

  async function verify(event) {
    event.preventDefault()
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the six-digit authenticator code.')
      return
    }
    setBusy(true)
    setError('')
    try {
      const id = phase === 'enroll' ? enrollment?.id : factor?.id
      if (!id) throw new Error('Missing factor')
      const result = await supabase.auth.mfa.challengeAndVerify({ factorId: id, code })
      if (result.error) throw result.error
      setCode('')
      setEnrollment(null)
      setPhase('ready')
    } catch {
      setError('The code could not be verified. Check your authenticator and try again.')
    } finally { setBusy(false) }
  }

  if (phase === 'ready') return children
  return (
    <main role="main" style={{ maxWidth: 440, margin: '10vh auto', padding: 24 }}>
      <h1>Account security</h1>
      {phase === 'loading' && <p>Checking authenticator status…</p>}
      {phase === 'error' && <button type="button" onClick={() => void inspect().catch(() => setError('Unable to verify MFA status.'))}>Retry</button>}
      {phase === 'offer' && <>
        <p>Protect your staff account with a free authenticator app. You can activate this now without changing your password.</p>
        <button type="button" disabled={busy} onClick={startEnrollment}>Set up authenticator</button>{' '}
        <button type="button" onClick={() => setPhase('ready')}>Not now</button>
      </>}
      {phase === 'enroll' && <>
        <p>Scan this QR code with your authenticator app, then enter the six-digit code.</p>
        {enrollment?.totp?.qr_code && <img
          src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(enrollment.totp.qr_code)}
          alt="Authenticator setup QR code" width="220" height="220"
        />}
        <p>Manual setup secret (keep private): <code>{enrollment?.totp?.secret}</code></p>
      </>}
      {(phase === 'challenge' || phase === 'enroll') && <form onSubmit={verify}>
        <label htmlFor="staff-mfa-code">Six-digit code</label>
        <input id="staff-mfa-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
          value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} required />
        <button type="submit" disabled={busy}>{busy ? 'Checking…' : 'Verify code'}</button>
      </form>}
      {error && <p role="alert">{error}</p>}
      <p><button type="button" onClick={onSignOut}>Sign out</button></p>
    </main>
  )
}
