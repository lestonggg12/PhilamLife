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

  const refreshOrganization = useCallback(async () => {
    if (!enabled) {
      return
    }

    const { data, error } = await supabase
      .from('system_settings')
      .select(
        'hoa_name, address, contact_email, contact_phone, currency, timezone',
      )
      .eq('id', 1)
      .maybeSingle()

    if (!error && data) {
      const nextOrganization = mapSettings(data)
      setOrganization(nextOrganization)
      localStorage.setItem(CACHE_KEY, JSON.stringify(nextOrganization))
    }
  }, [enabled])

  useEffect(() => {
    refreshOrganization()
  }, [refreshOrganization])

  useEffect(() => {
    document.title = `${organization.hoaName} - HOA Management System`
  }, [organization.hoaName])

  const value = useMemo(
    () => ({
      organization,
      refreshOrganization,
      formatMoney: (value) =>
        formatCurrency(value, organization.currency),
    }),
    [organization, refreshOrganization],
  )

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