import { supabase } from './supabase'
import type { Prefs } from '../types'

export const defaultPrefs: Prefs = { text_scale: 1, theme: 'light', contrast: 'normal' }

export function applyPrefs(p: Prefs) {
  const r = document.documentElement
  r.style.setProperty('--font-scale', String(p.text_scale))
  r.dataset.theme = p.theme
  r.dataset.contrast = p.contrast
}

export async function loadPrefs(userId: string): Promise<Prefs> {
  const { data } = await supabase
    .from('preferences')
    .select('text_scale,theme,contrast')
    .eq('user_id', userId)
    .maybeSingle()
  return data ? { ...defaultPrefs, ...(data as Prefs) } : defaultPrefs
}

export async function savePrefs(userId: string, p: Prefs) {
  return supabase
    .from('preferences')
    .upsert({ user_id: userId, ...p, updated_at: new Date().toISOString() })
}
