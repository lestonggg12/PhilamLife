

import React, { useState } from 'react'
import { BrowserRouter, Routes, Route, useNavigate } from 'react-router-dom'
import Layout from './components/Layout'
import LandingPage from './pages/LandingPage'
import LoginPage from './pages/LoginPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import DashboardPage from './pages/DashboardPage'
import PaymentsPage from './pages/PaymentsPage'
import ReportsPage from './pages/ReportsPage'
import LedgerPage from './pages/LedgerPage'
import UserManagementPage from './pages/UserManagementPage'
import AdminDashboard from './pages/AdminDashboard'
import TreasurerDashboard from './pages/TreasurerDashboard'
import SecretaryDashboard from './pages/SecretaryDashboard'
import SecretaryPayablesPage from './pages/SecretaryPayablesPage'
import ActivityLogPage from './pages/ActivityLogPage'
import DocumentLibraryPage from './pages/DocumentLibraryPage'
import EventCalendarPage from './pages/EventCalendarPage'
import ContactManagerPage from './pages/ContactManagerPage'
import SystemSettingsPage from './pages/SystemSettingsPage'
import './App.css'

function AppContent() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [user, setUser] = useState(null)
  const navigate = useNavigate()

  const handleLogout = () => {
    setIsAuthenticated(false)
    setUser(null)
    navigate('/login')
  }

  return (
    <Routes>
      {/* Public Routes */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage setIsAuthenticated={setIsAuthenticated} setUser={setUser} />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      
      {/* Protected Routes */}
    <Route element={<Layout user={user} onLogout={handleLogout} />}>
  <Route path="/admin/dashboard" element={<AdminDashboard />} />
  <Route path="/treasurer/dashboard" element={<TreasurerDashboard />} />
  <Route path="/secretary/dashboard" element={<SecretaryDashboard />} />
  <Route path="/secretary/payables" element={<SecretaryPayablesPage />} />
  <Route path="/ledger" element={<LedgerPage />} />
  <Route path="/payments" element={<PaymentsPage />} />
  <Route path="/reports" element={<ReportsPage />} />
  <Route path="/activity-log" element={<ActivityLogPage />} />
  <Route path="/documents" element={<DocumentLibraryPage />} />
  <Route path="/calendar" element={<EventCalendarPage />} />
  <Route path="/contacts" element={<ContactManagerPage />} />
  <Route path="/user-management" element={<UserManagementPage />} />
  <Route path="/system-settings" element={<SystemSettingsPage />} />
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
