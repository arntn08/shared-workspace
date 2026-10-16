import { useEffect, useState } from 'react'
import { supabase } from './supabase'

export interface DashSettings {
  title: string
  welcome: string
  group_by_month: boolean
  show_search: boolean
}

export const defaultSettings: DashSettings = {
  title: 'Shared Workspace',
  welcome: 'Your assigned files',
  group_by_month: false,
  show_search: true
}

export async function loadSettings(): Promise<DashSettings> {
  const { data } = await supabase
    .from('dashboard_settings')
    .select('settings')
    .eq('id', 1)
    .maybeSingle()
  return { ...defaultSettings, ...(data?.settings ?? {}) }
}

export async function saveSettings(s: DashSettings) {
  return supabase.from('dashboard_settings').upsert({ id: 1, settings: s })
}

export function useSettings() {
  const [s, setS] = useState<DashSettings>(defaultSettings)
  useEffect(() => {
    loadSettings().then(setS)
  }, [])
  return [s, setS] as const
}
