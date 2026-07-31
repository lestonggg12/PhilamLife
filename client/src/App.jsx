import React, { useEffect, useState } from 'react'
import {
  BrowserRouter,
  Routes,
  Route,
  useNavigate,
} from 'react-router-dom'
import { supabase } from './lib/supabaseClient'
import Layout from './components/Layout'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import TwoFactorPage from './pages/TwoFactorPage'
import AdminDashboard from './pages/AdminDashboard'
import TreasurerDashboard from './pages/TreasurerDashboard'
import TreasurerExpensesPage from './pages/TreasurerExpensesPage'
import SecretaryDashboard from './pages/SecretaryDashboard'
import SecretaryPayablesPage from './pages/SecretaryPayablesPage'
import ServicesManagementPage from './pages/ServicesManagementPage'
import OfficialReceiptsPage from './pages/OfficialReceiptsPage'
import PaymentsPage from './pages/PaymentsPage'
import ReportsPage from './pages/ReportsPage'
import TreasurerServiceRevenuePage from './pages/TreasurerServiceRevenuePage'
import LedgerPage from './pages/LedgerPage'
import ActivityLogPage from './pages/ActivityLogPage'
import DocumentLibraryPage from './pages/DocumentLibraryPage'
import EventCalendarPage from './pages/EventCalendarPage'
import ContactManagerPage from './pages/ContactManagerPage'
import SystemSettingsPage from './pages/SystemSettingsPage'
import ProtectedRoute from './components/ProtectedRoute'
import { OrganizationProvider } from './context/OrganizationContext'
import {
  clearRememberMePreference,
} from './lib/supabaseClient'
import { getMfaRequirement } from './lib/mfa'
import './App.css'

function AppContent() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [user, setUser] = useState(null)
  const [pendingUser, setPendingUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const navigate = useNavigate()

  const dashboardForRole = (role) => ({
    admin: '/admin/dashboard',
    treasurer: '/treasurer/dashboard',
    secretary: '/secretary/dashboard',
  })[role] || '/login'

  const completeAuthentication = (profile) => {
    setPendingUser(null)
    setUser(profile)
    setIsAuthenticated(true)
    navigate(dashboardForRole(profile?.role), { replace: true })
  }

  const requireMfa = (profile) => {
    setIsAuthenticated(false)
    setUser(null)
    setPendingUser(profile)
    navigate('/two-factor', { replace: true })
  }

  useEffect(() => {
    const restoreSession = async () => {
      if (window.location.pathname === '/reset-password') {
        setLoading(false)
        return
      }

      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (session) {
        try {
          const [{ data: profile, error }, requirement] = await Promise.all([
            supabase
              .from('profiles')
              .select('*')
              .eq('id', session.user.id)
              .single(),
            getMfaRequirement(),
          ])

          if (!error && profile) {
            if (requirement.status === 'ready') {
              setIsAuthenticated(true)
              setUser(profile)
            } else {
              setPendingUser(profile)
              navigate('/two-factor', { replace: true })
            }
          }
        } catch (restoreError) {
          console.error('Unable to restore the secure session:', restoreError)
          await supabase.auth.signOut()
        }
      }

      setLoading(false)
    }

    restoreSession()

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!session) {
          setIsAuthenticated(false)
          setUser(null)
          setPendingUser(null)
        }
      }
    )

    return () => {
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!isAuthenticated || !user) return undefined

    let active = true

    const enforceWeeklyMfa = async () => {
      try {
        const requirement = await getMfaRequirement()
        if (active && requirement.status !== 'ready') {
          requireMfa(user)
        }
      } catch (mfaError) {
        console.error('Unable to recheck two-factor authentication:', mfaError)
      }
    }

    const intervalId = window.setInterval(enforceWeeklyMfa, 60 * 1000)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        enforceWeeklyMfa()
      }
    }

    window.addEventListener('focus', enforceWeeklyMfa)
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      active = false
      window.clearInterval(intervalId)
      window.removeEventListener('focus', enforceWeeklyMfa)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [isAuthenticated, user])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    clearRememberMePreference()

    setIsAuthenticated(false)
    setUser(null)
    setPendingUser(null)
    navigate('/login')
  }

  if (loading) {
    return <div>Loading...</div>
  }

  return (
    <OrganizationProvider enabled={isAuthenticated}>
      <Routes>
      <Route path="/" element={<LandingPage />} />

      <Route
        path="/login"
        element={
          <LoginPage
            onAuthenticated={completeAuthentication}
            onMfaRequired={requireMfa}
          />
        }
      />

      <Route
        path="/two-factor"
        element={
          pendingUser ? (
            <TwoFactorPage
              pendingUser={pendingUser}
              onVerified={() => completeAuthentication(pendingUser)}
              onCancel={handleLogout}
            />
          ) : (
            <ProtectedRoute isAuthenticated={isAuthenticated}>
              <TwoFactorPage
                pendingUser={user}
                onVerified={() => completeAuthentication(user)}
                onCancel={handleLogout}
              />
            </ProtectedRoute>
          )
        }
      />

      <Route
        path="/forgot-password"
        element={<ForgotPasswordPage />}
      />

      <Route
        path="/reset-password"
        element={<ResetPasswordPage />}
      />

      <Route
        element={
          <ProtectedRoute isAuthenticated={isAuthenticated}>
            <Layout user={user} onLogout={handleLogout} />
          </ProtectedRoute>
        }
      >
        <Route
          path="/admin/dashboard"
          element={
            <ProtectedRoute
              isAuthenticated={isAuthenticated}
              user={user}
              allowedRoles={['admin']}
            >
              <AdminDashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/treasurer/dashboard"
          element={
            <ProtectedRoute
              isAuthenticated={isAuthenticated}
              user={user}
              allowedRoles={['treasurer']}
            >
              <TreasurerDashboard />
            </ProtectedRoute>
          }
        />
          <Route
          path="/treasurer/expenses"
          element={
            <ProtectedRoute
              isAuthenticated={isAuthenticated}
              user={user}
              allowedRoles={['treasurer']}
            >
              <TreasurerExpensesPage user={user} />
            </ProtectedRoute>
          }
        />
           <Route
              path="/treasurer/service-revenue"
              element={
                <ProtectedRoute
                  isAuthenticated={isAuthenticated}
                  user={user}
                  allowedRoles={['treasurer']}
                >
                  <TreasurerServiceRevenuePage />
                </ProtectedRoute>
              }
            />



        <Route
          path="/secretary/dashboard"
          element={
            <ProtectedRoute
              isAuthenticated={isAuthenticated}
              user={user}
              allowedRoles={['secretary']}
            >
              <SecretaryDashboard />
            </ProtectedRoute>
          }
        />

        <Route
          path="/secretary/payables"
          element={
            <ProtectedRoute
              isAuthenticated={isAuthenticated}
              user={user}
              allowedRoles={['admin', 'secretary', 'treasurer']}
            >
              <SecretaryPayablesPage user={user} />
            </ProtectedRoute>
          }
        />

        <Route
          path="/secretary/services"
          element={
            <ProtectedRoute
              isAuthenticated={isAuthenticated}
              user={user}
              allowedRoles={['secretary']}
            >
              <ServicesManagementPage user={user} />
            </ProtectedRoute>
          }
        />

        <Route
          path="/secretary/receipts"
          element={
            <ProtectedRoute
              isAuthenticated={isAuthenticated}
              user={user}
              allowedRoles={['secretary']}
            >
              <OfficialReceiptsPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/ledger"
          element={
            <ProtectedRoute
              isAuthenticated={isAuthenticated}
              user={user}
              allowedRoles={['admin', 'treasurer', 'secretary']}
            >
              <LedgerPage user={user} />
            </ProtectedRoute>
          }
        />

        <Route
          path="/payments"
          element={
            <ProtectedRoute
              isAuthenticated={isAuthenticated}
              user={user}
              allowedRoles={['admin', 'secretary', 'treasurer']}
            >
              <PaymentsPage user={user} />
            </ProtectedRoute>
          }
        />

        <Route
          path="/reports"
          element={
            <ProtectedRoute
              isAuthenticated={isAuthenticated}
              user={user}
              allowedRoles={['admin', 'treasurer']}
            >
              <ReportsPage user={user} />
            </ProtectedRoute>
          }
        />

       <Route
        path="/activity-log"
        element={
          <ProtectedRoute
            isAuthenticated={isAuthenticated}
            user={user}
            allowedRoles={['admin', 'secretary', 'treasurer']}
          >
            <ActivityLogPage />
          </ProtectedRoute>
        }
      />

        <Route
          path="/documents"
          element={
            <ProtectedRoute
              isAuthenticated={isAuthenticated}
              user={user}
              allowedRoles={['secretary']}
            >
              <DocumentLibraryPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/calendar"
          element={
            <ProtectedRoute
              isAuthenticated={isAuthenticated}
              user={user}
              allowedRoles={['admin', 'treasurer', 'secretary']}
            >
              <EventCalendarPage user={user} />
            </ProtectedRoute>
          }
        />

        <Route
          path="/contacts"
          element={
            <ProtectedRoute
              isAuthenticated={isAuthenticated}
              user={user}
              allowedRoles={['admin', 'secretary', 'treasurer']}
            >
              <ContactManagerPage user={user} />
            </ProtectedRoute>
          }
        />

        <Route
          path="/system-settings"
          element={
            <ProtectedRoute
              isAuthenticated={isAuthenticated}
              user={user}
              allowedRoles={['admin']}
            >
              <SystemSettingsPage user={user} />
            </ProtectedRoute>
          }
        />
      </Route>
    </Routes>
    </OrganizationProvider>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  )
}

export default App