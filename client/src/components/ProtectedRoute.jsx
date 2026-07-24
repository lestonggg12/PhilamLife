import { Navigate } from 'react-router-dom'

const dashboardByRole = {
  admin: '/admin/dashboard',
  treasurer: '/treasurer/dashboard',
  secretary: '/secretary/dashboard',
}

export default function ProtectedRoute({ isAuthenticated, user, allowedRoles, children }) {
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  const role = user?.role?.trim().toLowerCase()
  const normalizedAllowedRoles = allowedRoles?.map((allowedRole) =>
    allowedRole.trim().toLowerCase(),
  )

  if (normalizedAllowedRoles && !normalizedAllowedRoles.includes(role)) {
    return <Navigate to={dashboardByRole[role] || '/login'} replace />
  }

  return children
}