import { Navigate } from 'react-router-dom'
import ErrorPage from './ErrorPage'

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
    const roleLabel = role ? `${role.charAt(0).toUpperCase()}${role.slice(1)}` : 'Your'

    return (
      <ErrorPage
        inline
        icon="forbidden"
        tone="danger"
        code="403"
        title="Access denied"
        message={`${role ? `${roleLabel} accounts don't` : "Your account doesn't"} have permission to open this page.`}
        actions={[
          {
            label: 'Back to dashboard',
            to: dashboardByRole[role] || '/login',
            primary: true,
          },
        ]}
      />
    )
  }

  return children
}