import axios from 'axios'

const API_BASE_URL = 'http://localhost:3000/api'

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Auth Service
export const authService = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  logout: () => api.post('/auth/logout'),
  register: (data) => api.post('/auth/register', data),
}

// Properties Service
export const propertiesService = {
  getAll: () => api.get('/properties'),
  getById: (id) => api.get(`/properties/${id}`),
  create: (data) => api.post('/properties', data),
  update: (id, data) => api.put(`/properties/${id}`, data),
  delete: (id) => api.delete(`/properties/${id}`),
}

// Owners Service
export const ownersService = {
  getAll: () => api.get('/owners'),
  getById: (id) => api.get(`/owners/${id}`),
  create: (data) => api.post('/owners', data),
  update: (id, data) => api.put(`/owners/${id}`, data),
  delete: (id) => api.delete(`/owners/${id}`),
}

// Payments Service
export const paymentsService = {
  getAll: () => api.get('/payments'),
  getById: (id) => api.get(`/payments/${id}`),
  create: (data) => api.post('/payments', data),
  generateReceipt: (id) => api.get(`/payments/${id}/receipt`),
}

// Reports Service
export const reportsService = {
  getCollections: (month, year) => api.get(`/reports/collections?month=${month}&year=${year}`),
  getUnpaidAccounts: () => api.get('/reports/unpaid'),
  getAnnualSummary: (year) => api.get(`/reports/annual?year=${year}`),
  getExpenses: () => api.get('/reports/expenses'),
}

// Dashboard Service
export const dashboardService = {
  getStats: () => api.get('/dashboard/stats'),
  getRecentPayments: () => api.get('/dashboard/recent-payments'),
}

export default api
