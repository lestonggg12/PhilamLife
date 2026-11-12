import React, { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import './MfaGate.css'

// Staged rollout: optional first-factor enrollment, but mandatory challenge
// for users who have already enrolled TOTP.
export default function MfaGate({ children, onSignOut, offerEnrollment = false }) {
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
    const verified = factors.data.totp?.find(
      (item) => item.status === 'verified',
    )
    if (verified && levels.data.currentLevel !== 'aal2') {
      setFactor(verified)
      setPhase('challenge')
    } else if (verified) {
      setPhase('ready')
    } else {
      // Enrollment is optional: normal sign-in proceeds directly to the dashboard.
      // An explicit setup screen can opt in with offerEnrollment.
      setPhase(offerEnrollment ? 'offer' : 'ready')
    }
  }, [offerEnrollment])

  useEffect(() => {
    let cancelled = false
    // inspect is bound to this mounted gate; do not start enrollment automatically.
    inspect().catch(() => {
      if (!cancelled) {
        setError(
          'Unable to verify your security status. Check your connection and retry.',
        )
        setPhase('error')
      }
    })
    return () => {
      cancelled = true
    }
  }, [inspect])

  async function startEnrollment() {
    setBusy(true)
    setError('')
    try {
      const result = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'PhilamLife staff',
      })
      if (result.error) throw result.error
      setEnrollment(result.data)
      setPhase('enroll')
    } catch {
      setError('Unable to start authenticator setup. Try again.')
    } finally {
      setBusy(false)
    }
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
      const result = await supabase.auth.mfa.challengeAndVerify({
        factorId: id,
        code,
      })
      if (result.error) throw result.error
      setCode('')
      setEnrollment(null)
      setPhase('ready')
    } catch {
      setError(
        'The code could not be verified. Check your authenticator and try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  // Do not flash the account-security card during routine session inspection.
  if (phase === 'loading') return null
  if (phase === 'ready') return children
  return (
    <main className="mfa-page">
      <section
        className="mfa-card"
        aria-labelledby="staff-security-title"
        aria-busy={busy}
      >
        <div className="mfa-brand">
          <span className="mfa-shield" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              width="25"
              height="25"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
            >
              <path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6z" />
              <path d="m8.5 12 2.5 2.5 4.5-5" />
            </svg>
          </span>
          <span>
            PHILAM VILLAGE<small>Staff account protection</small>
          </span>
        </div>
        <header className="mfa-heading">
          <p>Account security</p>
          <h1 id="staff-security-title">
            {phase === 'enroll'
              ? 'Set up your authenticator'
              : phase === 'challenge'
                ? 'Verify your sign-in'
                : 'Keep your account protected'}
          </h1>
        </header>
        {phase === 'loading' && (
          <p className="mfa-description" role="status">
            Checking authenticator status…
          </p>
        )}
        {phase === 'error' && (
          <button
            className="mfa-button mfa-primary"
            type="button"
            onClick={() =>
              void inspect().catch(() =>
                setError('Unable to verify MFA status.'),
              )
            }
          >
            Try again
          </button>
        )}
        {phase === 'offer' && (
          <>
            <p className="mfa-description">
              Protect your staff account with a free authenticator app. You can
              activate this now without changing your password.
            </p>
            <div className="mfa-benefit">
              <span aria-hidden="true">✓</span> Adds a six-digit verification
              code when you sign in.
            </div>
            <div className="mfa-actions">
              <button
                className="mfa-button mfa-primary"
                type="button"
                disabled={busy}
                onClick={startEnrollment}
              >
                {busy ? 'Starting setup…' : 'Set up authenticator'}
              </button>
              <button
                className="mfa-button mfa-secondary"
                type="button"
                disabled={busy}
                onClick={() => setPhase('ready')}
              >
                Not now
              </button>
            </div>
          </>
        )}
        {phase === 'enroll' && (
          <>
            <p className="mfa-description">
              Scan this QR code with your authenticator app, then enter the
              six-digit code.
            </p>
            {enrollment?.totp?.qr_code && (
              <div className="mfa-qr">
                <img
                  src={
                    'data:image/svg+xml;charset=utf-8,' +
                    encodeURIComponent(enrollment.totp.qr_code)
                  }
                  alt="Authenticator setup QR code"
                  width="220"
                  height="220"
                />
              </div>
            )}
            <details className="mfa-manual">
              <summary>Can’t scan the QR code?</summary>
              <p>
                Enter this secret manually in your authenticator app. Keep it
                private.
              </p>
              <code>{enrollment?.totp?.secret}</code>
            </details>
          </>
        )}
        {(phase === 'challenge' || phase === 'enroll') && (
          <form className="mfa-form" onSubmit={verify}>
            {phase === 'challenge' && (
              <p className="mfa-description">
                Open your authenticator app and enter the current code to
                continue.
              </p>
            )}
            <label htmlFor="staff-mfa-code">Six-digit code</label>
            <input
              id="staff-mfa-code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              aria-describedby={error ? 'staff-mfa-error' : undefined}
              aria-invalid={Boolean(error)}
              value={code}
              onChange={(e) =>
                setCode(e.target.value.replace(/\D/g, '').slice(0, 6))
              }
              required
            />
            <button
              className="mfa-button mfa-primary"
              type="submit"
              disabled={busy}
            >
              {busy ? 'Checking…' : 'Verify code'}
            </button>
          </form>
        )}
        {error && (
          <p className="mfa-error" id="staff-mfa-error" role="alert">
            {error}
          </p>
        )}
        <footer className="mfa-footer">
          <span>Signed in to your staff account</span>
          <button type="button" onClick={onSignOut}>
            Sign out
          </button>
        </footer>
      </section>
    </main>
  )
}
