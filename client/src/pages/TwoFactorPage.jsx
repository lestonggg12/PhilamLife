import React, { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'
import { MFA_TRUST_DAYS, getMfaRequirement } from '../lib/mfa'
import { useOrganization } from '../context/OrganizationContext'
import './TwoFactorPage.css'

export default function TwoFactorPage({ pendingUser, onVerified, onCancel }) {
  const { organization } = useOrganization()
  const [mode, setMode] = useState('loading')
  const [factorId, setFactorId] = useState('')
  const [qrCode, setQrCode] = useState('')
  const [secret, setSecret] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let active = true

    const inspectFactors = async () => {
      try {
        const requirement = await getMfaRequirement()
        if (!active) return

        if (requirement.status === 'ready') {
          onVerified()
          return
        }

        setMode(requirement.status)
        setFactorId(requirement.factor?.id || '')
      } catch (mfaError) {
        if (active) {
          setError(mfaError.message || 'Unable to check two-factor authentication.')
          setMode('error')
        }
      }
    }

    inspectFactors()
    return () => {
      active = false
    }
  }, [onVerified])

  const beginEnrollment = async () => {
    setLoading(true)
    setError('')

    const { data, error: enrollError } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: `${organization.hoaName} desktop app`,
    })

    if (enrollError) {
      setError(enrollError.message)
      setLoading(false)
      return
    }

    setFactorId(data.id)
    setQrCode(data.totp.qr_code)
    setSecret(data.totp.secret)
    setMode('enrollment-code')
    setLoading(false)
  }

  const verifyCode = async (event) => {
    event.preventDefault()

    if (!/^\d{6}$/.test(code)) {
      setError('Enter the six-digit code from your authenticator app.')
      return
    }

    setLoading(true)
    setError('')

    const { error: verifyError } =
      await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code,
      })

    if (verifyError) {
      setError('The code is invalid or expired. Wait for a new code and try again.')
      setCode('')
      setLoading(false)
      return
    }

    await supabase.from('activity_log').insert({
      user_id: pendingUser?.id,
      action:
        mode === 'enrollment-code'
          ? 'Two-Factor Authentication Enabled'
          : 'Two-Factor Authentication Verified',
      target: `Trusted this device for ${MFA_TRUST_DAYS} days`,
    })

    setLoading(false)
    onVerified()
  }

  return (
    <div className="two-factor-page">
      <div className="two-factor-orb two-factor-orb-one" />
      <div className="two-factor-orb two-factor-orb-two" />

      <section className="two-factor-card" aria-labelledby="two-factor-title">
        <div className="two-factor-shield" aria-hidden="true">
          <i className="ti ti-shield-lock" />
        </div>

        <p className="two-factor-eyebrow">{organization.hoaName}</p>
        <h1 id="two-factor-title">Two-Factor Authentication</h1>

        {mode === 'loading' && (
          <p className="two-factor-description">Checking account security…</p>
        )}

        {mode === 'enroll' && (
          <>
            <p className="two-factor-description">
              Protect your account with Google Authenticator, Microsoft
              Authenticator, Authy, or another authenticator app.
            </p>
            <ol className="two-factor-steps">
              <li>Install or open an authenticator app on your phone.</li>
              <li>Scan the QR code that will appear on this screen.</li>
              <li>Enter the six-digit code to finish setup.</li>
            </ol>
            <button
              className="two-factor-primary"
              type="button"
              onClick={beginEnrollment}
              disabled={loading}
            >
              {loading ? 'Preparing…' : 'Set Up Authenticator'}
            </button>
          </>
        )}

        {mode === 'enrollment-code' && (
          <>
            <p className="two-factor-description">
              Scan this QR code, then enter the six-digit code shown in your app.
            </p>
            <img
              className="two-factor-qr"
              src={qrCode}
              alt="Authenticator setup QR code"
            />
            <details className="two-factor-secret">
              <summary>Cannot scan the QR code?</summary>
              <p>Enter this setup key manually:</p>
              <code>{secret}</code>
            </details>
          </>
        )}

        {mode === 'verify' && (
          <p className="two-factor-description">
            Enter the code from your authenticator app. After verification,
            this remembered device stays trusted for {MFA_TRUST_DAYS} days.
          </p>
        )}

        {(mode === 'verify' || mode === 'enrollment-code') && (
          <form onSubmit={verifyCode}>
            <label className="two-factor-label" htmlFor="two-factor-code">
              Six-digit authentication code
            </label>
            <input
              id="two-factor-code"
              className="two-factor-input"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength="6"
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
              }
              placeholder="000000"
              autoFocus
            />
            <button
              className="two-factor-primary"
              type="submit"
              disabled={loading || code.length !== 6}
            >
              {loading ? 'Verifying…' : 'Verify and Continue'}
            </button>
          </form>
        )}

        {error && <p className="two-factor-error">{error}</p>}

        <button
          className="two-factor-cancel"
          type="button"
          onClick={onCancel}
          disabled={loading}
        >
          Sign out
        </button>
      </section>
    </div>
  )
}