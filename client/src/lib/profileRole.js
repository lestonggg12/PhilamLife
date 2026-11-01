// Canonicalize database profile roles before routing or page permission checks.
export function normalizeRole(role) {
  return typeof role === 'string' ? role.trim().toLowerCase() : ''
}

export function normalizeProfileRole(profile) {
  return profile ? { ...profile, role: normalizeRole(profile.role) } : profile
}
