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
import AdminDashboard from './pages/AdminDashboard'
import TreasurerDashboard from './pages/TreasurerDashboard'
import SecretaryDashboard from './pages/SecretaryDashboard'
import SecretaryPayablesPage from './pages/SecretaryPayablesPage'
import PaymentsPage from './pages/PaymentsPage'
import ReportsPage from './pages/ReportsPage'
import LedgerPage from './pages/LedgerPage'
import ActivityLogPage from './pages/ActivityLogPage'
import DocumentLibraryPage from './pages/DocumentLibraryPage'
import EventCalendarPage from './pages/EventCalendarPage'
import ContactManagerPage from './pages/ContactManagerPage'
import SystemSettingsPage from './pages/SystemSettingsPage'
import ProtectedRoute from './components/ProtectedRoute'
import './App.css'

function AppContent() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  const navigate = useNavigate()

  useEffect(() => {
    const restoreSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (session) {
        const { data: profile, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single()

        if (!error && profile) {
          setIsAuthenticated(true)
          setUser(profile)
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

    setIsAuthenticated(false)
    setUser(null)
    navigate('/login')
  }

  if (loading) {
    return <div>Loading...</div>
  }

  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />

      <Route
        path="/login"
        element={
          <LoginPage
            setIsAuthenticated={setIsAuthenticated}
            setUser={setUser}
          />
        }
      />

      <Route
        path="/forgot-password"
        element={<ForgotPasswordPage />}
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
          element={<SecretaryPayablesPage />}
        />

        <Route
          path="/ledger"
          element={<LedgerPage user={user} />}
        />

        <Route path="/payments" element={<PaymentsPage user={user} />} />        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/activity-log" element={<ActivityLogPage />} />
        <Route path="/documents" element={<DocumentLibraryPage />} />
        <Route path="/calendar" element={<EventCalendarPage />} />
        <Route path="/contacts" element={<ContactManagerPage />} />
        <Route
          path="/system-settings"
          element={<SystemSettingsPage />}
        />
      </Route>
    </Routes>
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