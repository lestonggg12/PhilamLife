import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

const PERSISTENCE_KEY = 'philam-auth-persistence'

const browserAuthStorage = {
  getItem(key) {
    const preferredStorage =
      localStorage.getItem(PERSISTENCE_KEY) === 'session'
        ? sessionStorage
        : localStorage
    const fallbackStorage =
      preferredStorage === localStorage ? sessionStorage : localStorage

    return preferredStorage.getItem(key) ?? fallbackStorage.getItem(key)
  },
  setItem(key, value) {
    const useSessionStorage =
      localStorage.getItem(PERSISTENCE_KEY) === 'session'
    const targetStorage = useSessionStorage ? sessionStorage : localStorage
    const otherStorage = useSessionStorage ? localStorage : sessionStorage

    targetStorage.setItem(key, value)
    otherStorage.removeItem(key)
  },
  removeItem(key) {
    localStorage.removeItem(key)
    sessionStorage.removeItem(key)
  },
}

export function setRememberMePreference(rememberMe) {
  if (rememberMe) {
    localStorage.setItem(PERSISTENCE_KEY, 'local')
  } else {
    localStorage.setItem(PERSISTENCE_KEY, 'session')
  }
}

export function isRememberMeEnabled() {
  return localStorage.getItem(PERSISTENCE_KEY) === 'local'
}

export function clearRememberMePreference() {
  localStorage.removeItem(PERSISTENCE_KEY)
  sessionStorage.removeItem(PERSISTENCE_KEY)
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage: browserAuthStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})