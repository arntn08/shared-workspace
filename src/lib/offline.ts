import { useCallback, useEffect, useState } from 'react'

const NS = 'ws-cache:'

export interface Cached<T> {
  at: number
  data: T
}

export function cacheSet<T>(uid: string, key: string, data: T) {
  try {
    localStorage.setItem(`${NS}${uid}:${key}`, JSON.stringify({ at: Date.now(), data }))
  } catch {
    /* storage full or blocked: the app simply works online-only */
  }
}

export function cacheGet<T>(uid: string, key: string): Cached<T> | null {
  try {
    const raw = localStorage.getItem(`${NS}${uid}:${key}`)
    return raw ? (JSON.parse(raw) as Cached<T>) : null
  } catch {
    return null
  }
}

/** Removes everything this app saved on the device for one user. */
export function clearCache(uid: string) {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(`${NS}${uid}:`) || k === `ws-notif-${uid}`)
      .forEach((k) => localStorage.removeItem(k))
  } catch {
    /* nothing to clear */
  }
}

export function ageLabel(at: number) {
  const m = Math.floor((Date.now() - at) / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  if (m < 1440) return `${Math.floor(m / 60)} h ago`
  return `${Math.floor(m / 1440)} d ago`
}

// ---- In-app updates generated on the device (for example "your schedule changed") ----
export interface LocalUpdate {
  id: string
  title: string
  body: string
  at: number
  read: boolean
}
const UPDATES = 'updates'
const EVT = 'ws-local-updates'

const readUpdates = (uid: string) => cacheGet<LocalUpdate[]>(uid, UPDATES)?.data ?? []
function writeUpdates(uid: string, list: LocalUpdate[]) {
  cacheSet(uid, UPDATES, list.slice(0, 30))
  window.dispatchEvent(new Event(EVT))
}

export function addLocalUpdate(uid: string, title: string, body: string) {
  writeUpdates(uid, [{ id: crypto.randomUUID(), title, body, at: Date.now(), read: false }, ...readUpdates(uid)])
}

export function useLocalUpdates(uid: string | undefined) {
  const [list, setList] = useState<LocalUpdate[]>([])
  useEffect(() => {
    if (!uid) return
    const sync = () => setList(readUpdates(uid))
    sync()
    window.addEventListener(EVT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(EVT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [uid])
  const markAllRead = useCallback(() => {
    if (uid) writeUpdates(uid, readUpdates(uid).map((u) => ({ ...u, read: true })))
  }, [uid])
  const dismiss = useCallback(
    (id: string) => {
      if (uid) writeUpdates(uid, readUpdates(uid).filter((u) => u.id !== id))
    },
    [uid]
  )
  return { list, unread: list.filter((u) => !u.read).length, markAllRead, dismiss }
}
