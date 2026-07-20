import { Navigate } from 'react-router-dom'

export default function ProtectedRoute({ isAuthenticated, user, allowedRoles, children }) {
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }
  if (allowedRoles && !allowedRoles.includes(user?.role)) {
    return <Navigate to="/login" replace />
  }
  return children
}