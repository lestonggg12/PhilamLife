import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { supabase } from '../lib/supabaseClient'
import {
  DEFAULT_ORGANIZATION,
  formatCurrency,
  formatDate as formatDateValue,
  getAssociationName,
  getCurrencySymbol,
} from '../config/organization'

const OrganizationContext = createContext(null)
const CACHE_KEY = 'philamlife_organization'

function mapSettings(settings) {
  const hoaName =
    String(settings?.hoa_name || '').trim() ||
    DEFAULT_ORGANIZATION.hoaName
  const currency =
    String(settings?.currency || '').trim() ||
    DEFAULT_ORGANIZATION.currency

  return {
    hoaName,
    associationName: getAssociationName(hoaName),
    address:
      String(settings?.address || '').trim() ||
      DEFAULT_ORGANIZATION.address,
    contactEmail: String(settings?.contact_email || '').trim(),
    contactPhone: String(settings?.contact_phone || '').trim(),
    currency,
    currencySymbol: getCurrencySymbol(currency),
    locale: DEFAULT_ORGANIZATION.locale,
    timezone:
      String(settings?.timezone || '').trim() ||
      DEFAULT_ORGANIZATION.timezone,
    dateFormat:
      String(settings?.date_format || '').trim() ||
      DEFAULT_ORGANIZATION.dateFormat,
    requireStrongPassword:
      settings?.require_strong_password !== undefined
        ? Boolean(settings.require_strong_password)
        : DEFAULT_ORGANIZATION.requireStrongPassword,
    sessionTimeoutMinutes:
      Number(settings?.session_timeout) > 0
        ? Number(settings.session_timeout)
        : DEFAULT_ORGANIZATION.sessionTimeoutMinutes,
  }
}

const defaultOrganization = mapSettings()

function readCachedOrganization() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null')
    return cached ? { ...defaultOrganization, ...cached } : defaultOrganization
  } catch {
    return defaultOrganization
  }
}

export function OrganizationProvider({ enabled, children }) {
  const [organization, setOrganization] = useState(readCachedOrganization)

  // A confirmed UPDATE result can refresh the shared state without a second
  // network request. Existing callers can still refresh from the database.
  const refreshOrganization = useCallback(async (savedSettings) => {
    if (!enabled) return { error: new Error('The authenticated session is no longer available') }

    let data = savedSettings
    if (!data) {
      try {
        const result = await supabase
          .from('system_settings')
          .select(
            'hoa_name, address, contact_email, contact_phone, currency, timezone, session_timeout, date_format, require_strong_password',
          )
          .eq('id', 1)
          .maybeSingle()
        if (result.error || !result.data) {
          return { error: result.error || new Error('The settings row was not found') }
        }
        data = result.data
      } catch (error) {
        return { error }
      }
    }

    const nextOrganization = mapSettings(data)
    setOrganization(nextOrganization)
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(nextOrganization))
      return { error: null, cacheError: null }
    } catch (cacheError) {
      // Browser storage restrictions must not undo a committed database save
      // or prevent this session from receiving the confirmed settings.
      return { error: null, cacheError }
    }
  }, [enabled])

  useEffect(() => {
    refreshOrganization()
  }, [refreshOrganization])

  useEffect(() => {
    document.title = `${organization.hoaName} - HOA Management System`
  }, [organization.hoaName])

  const value = useMemo(() => {
    const formatMoney = (value) => formatCurrency(value, organization.currency)
    const formatDate = (value, opts) =>
      formatDateValue(value, {
        dateFormat: organization.dateFormat,
        timezone: organization.timezone,
        ...opts,
      })

    return {
      // formatMoney/formatDate are exposed both here (top level) and
      // nested inside `organization` itself, since call sites across the
      // app use both `const { formatDate } = useOrganization()` and
      // `const { organization } = useOrganization(); organization.formatDate(...)`.
      organization: { ...organization, formatMoney, formatDate },
      refreshOrganization,
      formatMoney,
      formatDate,
    }
  }, [organization, refreshOrganization])

  return (
    <OrganizationContext.Provider value={value}>
      {children}
    </OrganizationContext.Provider>
  )
}

export function useOrganization() {
  const context = useContext(OrganizationContext)

  if (!context) {
    throw new Error(
      'useOrganization must be used inside OrganizationProvider.',
    )
  }

  return context
}