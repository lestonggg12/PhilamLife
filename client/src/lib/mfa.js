import { supabase } from './supabaseClient'

export const MFA_TRUST_DAYS = 7
export const MFA_TRUST_MS = MFA_TRUST_DAYS * 24 * 60 * 60 * 1000

export async function getMfaRequirement() {
  const [{ data: factors, error: factorsError }, { data: aal, error: aalError }] =
    await Promise.all([
      supabase.auth.mfa.listFactors(),
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    ])

  if (factorsError) throw factorsError
  if (aalError) throw aalError

  const verifiedFactor = factors.totp.find(
    (factor) => factor.status === 'verified',
  )

  if (!verifiedFactor) {
    return {
      status: 'enroll',
      factor: null,
      verifiedAt: null,
    }
  }

  const latestTotp = [...(aal.currentAuthenticationMethods || [])]
    .filter(
      (entry) =>
        entry.method === 'mfa/totp' ||
        entry.method === 'totp',
    )
    .sort((first, second) => second.timestamp - first.timestamp)[0]

  const verifiedAt = latestTotp
    ? new Date(latestTotp.timestamp * 1000)
    : null
  const isRecent =
    verifiedAt && Date.now() - verifiedAt.getTime() < MFA_TRUST_MS

  return {
    status: isRecent ? 'ready' : 'verify',
    factor: verifiedFactor,
    verifiedAt,
  }
}