// Canonicalize database profile roles before routing or page permission checks.
export function normalizeRole(role) {
  return typeof role === 'string' ? role.trim().toLowerCase() : ''
}

export function normalizeProfileRole(profile) {
  return profile ? { ...profile, role: normalizeRole(profile.role) } : profile
}

// Only active profiles with a supported staff role may enter the app.
export function isActiveStaffProfile(profile) {
  return profile?.is_active === true &&
    ['admin', 'secretary', 'treasurer'].includes(normalizeRole(profile.role))
}
