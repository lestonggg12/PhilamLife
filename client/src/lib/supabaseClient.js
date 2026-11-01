import { createClient } from '@supabase/supabase-js'
import { createRememberedDevice, REMEMBER_CHANGED_EVENT } from './rememberDevice'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Match supabase-js's default project-specific storage key.
const authStorageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
export const rememberedDevice = createRememberedDevice({
  local: localStorage,
  session: sessionStorage,
  authKey: authStorageKey,
  changed: () => window.dispatchEvent(new Event(REMEMBER_CHANGED_EVENT)),
})
if (window.location.pathname === '/reset-password') rememberedDevice.prepareRecovery()

export const setRememberMePreference = (remember) => rememberedDevice.setPreference(remember)
export const isRememberMeEnabled = () => rememberedDevice.isEnabled()
export const clearRememberMePreference = () => rememberedDevice.clearPreference()

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    storage: rememberedDevice.storage,
    storageKey: authStorageKey,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})