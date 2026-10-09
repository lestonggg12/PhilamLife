import React, { useEffect, useState } from 'react'
import {
  BrowserRouter,
  Navigate,
  Routes,
  Route,
  useNavigate,
} from 'react-router-dom'
import { supabase, clearRememberMePreference } from './lib/supabaseClient'
import Layout from './components/Layout'
import ProtectedRoute from './components/ProtectedRoute'
import Loader from './components/Loader'
import { ConfirmProvider } from './components/ConfirmDialog'
import { OrganizationProvider } from './context/OrganizationContext'
import LandingPage from './pages/LandingPage'
import LegalPage from './pages/LegalPage2'
import GuidePage from './pages/GuidePage'
import LoginPage from './pages/LoginPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import AdminDashboard from './pages/AdminDashboard'
import TreasurerDashboard from './pages/TreasurerDashboard'
import TreasurerExpensesPage from './pages/TreasurerExpensesPage'
import TreasurerServiceRevenuePage from './pages/TreasurerServiceRevenuePage'
import SecretaryDashboard from './pages/SecretaryDashboard'
import ServicesManagementPage from './pages/ServicesManagementPage'
import OfficialReceiptsPage from './pages/OfficialReceiptsPage'
import PaymentsPage from './pages/PaymentsPage'
import ReportsPage from './pages/ReportsPage'
import LedgerPage from './pages/LedgerPage'
import ActivityLogPage from './pages/ActivityLogPage'
import DocumentLibraryPage from './pages/DocumentLibraryPage'
import EventCalendarPage from './pages/EventCalendarPage'
import ContactManagerPage from './pages/ContactManagerPage'
import HomeownersPage from './pages/HomeownersPage'
import SystemSettingsPage from './pages/SystemSettingsPage'
import OverdueAccountsPage from './pages/OverdueAccountsPage'
import './App.css'

function AppContent() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const navigate = useNavigate()

  const dashboardForRole = (role) =>
    ({
      admin: '/admin/dashboard',
      treasurer: '/treasurer/dashboard',
      secretary: '/secretary/dashboard',
    })[role] || '/login'

  const completeAuthentication = (profile) => {
    setUser(profile)
    setIsAuthenticated(true)
    navigate(dashboardForRole(profile?.role), { replace: true })
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
          const { data: profile, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .single()

          if (!error && profile?.is_active !== false) {
            setIsAuthenticated(true)
            setUser(profile)
          } else if (profile?.is_active === false) {
            await supabase.auth.signOut()
          }
        } catch (restoreError) {
          console.error('Unable to restore the session:', restoreError)
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
        }
      }
    )

    return () => {
      listener.subscription.unsubscribe()
    }
  }, [])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    clearRememberMePreference()

    setIsAuthenticated(false)
    setUser(null)
    navigate('/login')
  }

  if (loading) {
    return <Loader variant="fullscreen" />
  }

  // Wraps a page in the role check so each route below stays one line.
  const guarded = (allowedRoles, page) => (
    <ProtectedRoute
      isAuthenticated={isAuthenticated}
      user={user}
      allowedRoles={allowedRoles}
    >
      {page}
    </ProtectedRoute>
  )

  return (
    <OrganizationProvider enabled={isAuthenticated}>
      <ConfirmProvider>
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/guide" element={<GuidePage />} />
          <Route path="/privacy" element={<LegalPage page="privacy" />} />
          <Route path="/terms" element={<LegalPage page="terms" />} />
          <Route path="/security" element={<LegalPage page="security" />} />
          <Route
            path="/login"
            element={<LoginPage onAuthenticated={completeAuthentication} />}
          />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />

          {/* Signed-in routes (inside the app layout) */}
          <Route
            element={
              <ProtectedRoute isAuthenticated={isAuthenticated}>
                <Layout user={user} onLogout={handleLogout} />
              </ProtectedRoute>
            }
          >
            <Route
              path="/admin/dashboard"
              element={guarded(['admin'], <AdminDashboard />)}
            />

            <Route
              path="/treasurer/dashboard"
              element={guarded(['treasurer'], <TreasurerDashboard />)}
            />
            <Route
              path="/treasurer/expenses"
              element={guarded(
                ['treasurer'],
                <TreasurerExpensesPage user={user} />
              )}
            />
            <Route
              path="/treasurer/service-revenue"
              element={guarded(['treasurer'], <TreasurerServiceRevenuePage />)}
            />

            <Route
              path="/secretary/dashboard"
              element={guarded(['secretary'], <SecretaryDashboard />)}
            />
            <Route
              path="/secretary/services"
              element={guarded(
                ['secretary'],
                <ServicesManagementPage user={user} />
              )}
            />
            <Route
              path="/secretary/receipts"
              element={guarded(['secretary'], <OfficialReceiptsPage />)}
            />

            <Route
              path="/ledger"
              element={guarded(
                ['admin', 'treasurer', 'secretary'],
                <LedgerPage user={user} />
              )}
            />
            <Route
              path="/payments"
              element={guarded(
                ['admin', 'secretary', 'treasurer'],
                <PaymentsPage user={user} />
              )}
            />
            <Route
              path="/reports"
              element={guarded(
                ['admin', 'treasurer'],
                <ReportsPage user={user} />
              )}
            />
            <Route
              path="/activity-log"
              element={guarded(
                ['admin', 'secretary', 'treasurer'],
                <ActivityLogPage />
              )}
            />
            <Route
              path="/documents"
              element={guarded(
                ['admin', 'secretary', 'treasurer'],
                <DocumentLibraryPage />
              )}
            />
            <Route
              path="/calendar"
              element={guarded(
                ['admin', 'treasurer', 'secretary'],
                <EventCalendarPage user={user} />
              )}
            />
            <Route
              path="/contacts"
              element={guarded(
                ['admin', 'secretary', 'treasurer'],
                <ContactManagerPage user={user} />
              )}
            />
            <Route
              path="/homeowners/:homeownerId?"
              element={guarded(
                ['admin', 'secretary', 'treasurer'],
                <HomeownersPage />
              )}
            />
            <Route
              path="/overdue-accounts"
              element={guarded(
                ['admin', 'secretary', 'treasurer'],
                <OverdueAccountsPage user={user} />
              )}
            />
            <Route
              path="/system-settings"
              element={guarded(['admin'], <SystemSettingsPage user={user} />)}
            />
          </Route>

          {/* Anything else goes to the right home page */}
          <Route
            path="*"
            element={
              <Navigate
                to={isAuthenticated ? dashboardForRole(user?.role) : '/login'}
                replace
              />
            }
          />
        </Routes>
      </ConfirmProvider>
    </OrganizationProvider>
  )
}

function App() {
  return (
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <AppContent />
    </BrowserRouter>
  )
}

export default App