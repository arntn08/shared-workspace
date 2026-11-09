import { supabase } from './supabase'

export type WorkforceLocationRow = {
  user_id: string
  sharing_enabled: boolean
  consented_at: string | null
  latitude: number | null
  longitude: number | null
  accuracy_m: number | null
  captured_at: string | null
  last_seen_at: string | null
  updated_at: string
}

export type QueuedPosition = {
  latitude: number
  longitude: number
  accuracy: number | null
  capturedAt: string
}

const queueKey = (uid: string) => `ahba-location-queue:${uid}`
const consentKey = (uid: string) => `ahba-location-consent:${uid}'
const pendingKey = (uid: string) => `ahba-location-pending:${uid}`

export function localConsent(uid: string): { enabled: boolean; consentedAt: string | null } {
  try {
    const raw = localStorage.getItem(consentKey(uid))
    return raw ? JSON.parse(raw) : { enabled: false, consentedAt: null }
  } catch {
    return { enabled: false, consentedAt: null }
  }
}

export function saveLocalConsent(uid: string, enabled: boolean, consentedAt: string | null) {
  localStorage.setItem(consentKey(uid), JSON.stringify({ enabled, consentedAt }))
  localStorage.setItem(pendingKey(uid), enabled ? 'enabled' : 'disabled')
}

export function queuedPositions(uid: string): QueuedPosition[] {
  try { return JSON.parse(localStorage.getItem(queueKey(uid)) || '[]') as QueuedPosition[] }
  catch { return [] }
}

export function queuePosition(uid: string, position: GeolocationPosition) {
  const next: QueuedPosition[] = [...queuedPositions(uid), {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null,
    capturedAt: new Date(position.timestamp || Date.now()).toISOString()
  }].slice(-250)
  localStorage.setItem(queueKey(uid), JSON.stringify(next))
  return next.length
}

export async function syncLocationQueue(uid: string) {
  if (!navigator.onLine) return { synced: 0, pending: queuedPositions(uid).length }
  const consent = localConsent(uid)
  const pendingSetting = localStorage.getItem(pendingKey(uid))
  if (pendingSetting) {
    const { error } = await supabase.from('workforce_locations').upsert({
      user_id: uid,
      sharing_enabled: pendingSetting === 'enabled',
      consented_at: consent.consentedAt,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' })
    if (error) return { synced: 0, pending: queuedPositions(uid).length, error: error.message }
    localStorage.removeItem(pendingKey(uid))
  }
  if (!consent.enabled) return { synced: 0, pending: 0 }
  const queue = queuedPositions(uid)
  if (!queue.length) {
    await supabase.from('workforce_locations').upsert({
      user_id: uid, sharing_enabled: true, consented_at: consent.consentedAt,
      last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' })
    return { synced: 0, pending: 0 }
  }
  const latest = queue[queue.length - 1]
  const { error } = await supabase.from('workforce_locations').upsert({
    user_id: uid,
    sharing_enabled: true,
    consented_at: consent.consentedAt,
    latitude: latest.latitude,
    longitude: latest.longitude,
    accuracy_m: latest.accuracy,
    captured_at: latest.capturedAt,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }, { onConflict: 'user_id' })
  if (error) return { synced: 0, pending: queue.length, error: error.message }
  localStorage.removeItem(queueKey(uid))
  return { synced: queue.length, pending: 0 }
}

export async function fetchWorkforceLocations() {
  const { data, error } = await supabase
    .from('workforce_locations')
    .select('user_id,sharing_enabled,consented_at,latitude,longitude,accuracy_m,captured_at,last_seen_at,updated_at')
    .order('last_seen_at', { ascending: false })
  if (error) throw error
  return (data || []) as WorkforceLocationRow[]
}
