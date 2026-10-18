
import React, { Suspense, lazy, useEffect, useState } from 'react'
import {
  BrowserRouter,
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
import NetworkStatus from './components/NetworkStatus'

import './App.css'

// Lazy-loaded public pages
const LandingPage = lazy(() => import('./pages/LandingPage'))
const LegalPage = lazy(() => import('./pages/LegalPage2'))
const GuidePage = lazy(() => import('./pages/GuidePage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const ForgotPasswordPage = lazy(
  () => import('./pages/ForgotPasswordPage')
)
const ResetPasswordPage = lazy(
  () => import('./pages/ResetPasswordPage')
)

// Lazy-loaded dashboard pages
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'))

const TreasurerDashboard = lazy(
  () => import('./pages/TreasurerDashboard')
)

const TreasurerExpensesPage = lazy(
  () => import('./pages/TreasurerExpensesPage')
)

const TreasurerServiceRevenuePage = lazy(
  () => import('./pages/TreasurerServiceRevenuePage')
)

const SecretaryDashboard = lazy(
  () => import('./pages/SecretaryDashboard')
)

// Lazy-loaded management pages
const ServicesManagementPage = lazy(
  () => import('./pages/ServicesManagementPage')
)

const OfficialReceiptsPage = lazy(
  () => import('./pages/OfficialReceiptsPage')
)

const PaymentsPage = lazy(() => import('./pages/PaymentsPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const LedgerPage = lazy(() => import('./pages/LedgerPage'))
const ActivityLogPage = lazy(() => import('./pages/ActivityLogPage'))

const DocumentLibraryPage = lazy(
  () => import('./pages/DocumentLibraryPage')
)

const EventCalendarPage = lazy(
  () => import('./pages/EventCalendarPage')
)

const ContactManagerPage = lazy(
  () => import('./pages/ContactManagerPage')
)

const HomeownersPage = lazy(() => import('./pages/HomeownersPage'))

const SystemSettingsPage = lazy(
  () => import('./pages/SystemSettingsPage')
)

const OverdueAccountsPage = lazy(
  () => import('./pages/OverdueAccountsPage')
)

const NotFoundPage = lazy(() => import('./pages/NotFoundPage'))

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
    let isMounted = true

    const restoreSession = async () => {
      try {
        // Password recovery handles its own session flow.
        if (window.location.pathname === '/reset-password') {
          if (isMounted) setLoading(false)
          return
        }

        const {
          data: { session },
          error: sessionError,
        } = await supabase.auth.getSession()

        if (sessionError) {
          throw sessionError
        }

        if (session) {
          const { data: profile, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .single()

          if (error) {
            console.error(
              'Unable to restore the user profile:',
              error
            )
            await supabase.auth.signOut()
          } else if (profile?.is_active === false) {
            await supabase.auth.signOut()
          } else if (profile && isMounted) {
            setIsAuthenticated(true)
            setUser(profile)
          }
        }
      } catch (restoreError) {
        console.error(
          'Unable to restore the session:',
          restoreError
        )
        await supabase.auth.signOut()
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    restoreSession()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setIsAuthenticated(false)
        setUser(null)
      }
    })

    return () => {
      isMounted = false
      subscription.unsubscribe()
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

  // Keep role-based access checks consistent across protected routes.
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
        <Suspense fallback={<Loader variant="fullscreen" />}>
          <Routes>
            {/* Public routes */}
            <Route path="/" element={<LandingPage />} />
            <Route path="/guide" element={<GuidePage />} />

            <Route
              path="/privacy"
              element={<LegalPage page="privacy" />}
            />

            <Route
              path="/terms"
              element={<LegalPage page="terms" />}
            />

            <Route
              path="/security"
              element={<LegalPage page="security" />}
            />

            <Route
              path="/login"
              element={
                <LoginPage onAuthenticated={completeAuthentication} />
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

            {/* Signed-in routes inside the app layout */}
            <Route
              element={
                <ProtectedRoute isAuthenticated={isAuthenticated}>
                  <Layout user={user} onLogout={handleLogout} />
                </ProtectedRoute>
              }
            >
              {/* Admin */}
              <Route
                path="/admin/dashboard"
                element={guarded(['admin'], <AdminDashboard />)}
              />

              <Route
                path="/admin/expenses"
                element={guarded(
                  ['admin'],
                  <TreasurerExpensesPage user={user} />
                )}
              />

              <Route
                path="/system-settings"
                element={guarded(
                  ['admin'],
                  <SystemSettingsPage user={user} />
                )}
              />

              {/* Treasurer */}
              <Route
                path="/treasurer/dashboard"
                element={guarded(
                  ['treasurer'],
                  <TreasurerDashboard />
                )}
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
                element={guarded(
                  ['treasurer'],
                  <TreasurerServiceRevenuePage />
                )}
              />

              {/* Secretary */}
              <Route
                path="/secretary/dashboard"
                element={guarded(
                  ['secretary'],
                  <SecretaryDashboard />
                )}
              />

              <Route
                path="/secretary/expenses"
                element={guarded(
                  ['secretary'],
                  <TreasurerExpensesPage user={user} />
                )}
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
                element={guarded(
                  ['secretary'],
                  <OfficialReceiptsPage />
                )}
              />

              {/* Shared management and financial pages */}
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
            </Route>

            {/* Unknown URLs show a proper 404 */}
            <Route
              path="*"
              element={
                <NotFoundPage
                  homePath={
                    isAuthenticated
                      ? dashboardForRole(user?.role)
                      : '/login'
                  }
                  homeLabel={
                    isAuthenticated
                      ? 'Back to dashboard'
                      : 'Go to sign in'
                  }
                />
              }
            />
          </Routes>
        </Suspense>
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
      <NetworkStatus />
      <AppContent />
    </BrowserRouter>
  )
}

export default App
