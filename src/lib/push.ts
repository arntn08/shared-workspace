import { supabase } from './supabase'

// Paste your VAPID public key here (it is public by design). Empty = push stays off.
export const VAPID_PUBLIC_KEY = ''

export const pushSupported = () =>
  typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

function keyBytes(b64url: string) {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4)
  const raw = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

/** Returns an error message, or null when this device is subscribed. */
export async function enablePush(userId: string): Promise<string | null> {
  if (!pushSupported()) return 'This browser cannot receive push. On iPhone, add the app to your Home Screen first.'
  if (!VAPID_PUBLIC_KEY) return 'Push is not configured yet. Ask the owner to finish setup.'
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return 'Notifications are blocked. Allow them in your browser settings.'
  try {
    const reg = await navigator.serviceWorker.ready
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(VAPID_PUBLIC_KEY) }))
    const j = sub.toJSON()
    if (!j.endpoint || !j.keys?.p256dh || !j.keys?.auth) return 'Could not read the push subscription.'
    const { error } = await supabase.from('push_subscriptions').upsert(
      { user_id: userId, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, user_agent: navigator.userAgent.slice(0, 200) },
      { onConflict: 'endpoint' }
    )
    return error ? 'Could not save this device.' : null
  } catch {
    return 'Could not turn on push on this device.'
  }
}

export async function disablePush(userId: string) {
  if (!pushSupported()) return
  try {
    const reg = await navigator.serviceWorker.ready
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', sub.endpoint)
      await sub.unsubscribe()
    }
  } catch {
    /* nothing to remove */
  }
}
