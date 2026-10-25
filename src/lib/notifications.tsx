import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from './supabase'
import { useAuth } from './auth'

export interface Notif {
  id: string
  kind: 'file_update' | 'reminder'
  title: string
  body: string
  file_id: string | null
  due_on: string | null
  deliver_at: string
  read_at: string | null
  ack_at: string | null
  done_at: string | null
  email_status: string
  push_status: string
  delivery_error: string | null
  created_at: string
}

interface Ctx {
  items: Notif[]
  unread: number
  loading: boolean
  error: string
  offline: boolean
  reload: () => Promise<void>
  markRead: (ids: string[]) => Promise<void>
  ack: (id: string) => Promise<void>
  done: (id: string) => Promise<void>
}

const COLS = 'id,kind,title,body,file_id,due_on,deliver_at,read_at,ack_at,done_at,email_status,push_status,delivery_error,created_at'
const Context = createContext<Ctx>({
  items: [],
  unread: 0,
  loading: true,
  error: '',
  offline: false,
  reload: async () => {},
  markRead: async () => {},
  ack: async () => {},
  done: async () => {}
})
export const useNotifs = () => useContext(Context)

const cacheKey = (uid: string) => `ws-notif-${uid}`
function readCache(uid: string): Notif[] | null {
  try {
    const raw = localStorage.getItem(cacheKey(uid))
    return raw ? (JSON.parse(raw) as Notif[]) : null
  } catch {
    return null
  }
}

export function NotifProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const uid = profile?.id
  const [items, setItems] = useState<Notif[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [offline, setOffline] = useState(false)

  const reload = useCallback(async () => {
    if (!uid) return
    const { data, error: err } = await supabase
      .from('notifications')
      .select(COLS)
      .lte('deliver_at', new Date().toISOString())
      .order('deliver_at', { ascending: false })
      .limit(100)
    if (err) {
      setError('Could not refresh notifications.')
      const cached = readCache(uid)
      if (cached) {
        setItems(cached)
        setOffline(true)
      }
      setLoading(false)
      return
    }
    const list = (data ?? []) as Notif[]
    setItems(list)
    setOffline(false)
    setError('')
    setLoading(false)
    try {
      localStorage.setItem(cacheKey(uid), JSON.stringify(list.slice(0, 50)))
    } catch {
      /* cache is optional */
    }
  }, [uid])

  useEffect(() => {
    if (!uid) return
    reload()
    const ch = supabase
      .channel(`notif-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${uid}` }, () => reload())
      .subscribe()
    const tick = window.setInterval(reload, 60000)
    const onFocus = () => reload()
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onFocus)
    return () => {
      supabase.removeChannel(ch)
      window.clearInterval(tick)
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onFocus)
    }
  }, [uid, reload])

  const patch = useCallback(async (ids: string[], fields: Record<string, string>) => {
    if (ids.length === 0) return
    setItems((prev) => prev.map((n) => (ids.includes(n.id) ? ({ ...n, ...fields } as Notif) : n)))
    const { error: err } = await supabase.from('notifications').update(fields).in('id', ids)
    if (err) setError('Could not save that change.')
  }, [])

  const now = () => new Date().toISOString()
  const markRead = useCallback((ids: string[]) => patch(ids, { read_at: now() }), [patch])
  const ack = useCallback((id: string) => patch([id], { read_at: now(), ack_at: now() }), [patch])
  const done = useCallback((id: string) => patch([id], { read_at: now(), ack_at: now(), done_at: now() }), [patch])

  const unread = items.filter((n) => !n.read_at).length
  useEffect(() => {
    const nav = navigator as Navigator & { setAppBadge?: (n: number) => Promise<void>; clearAppBadge?: () => Promise<void> }
    if (unread > 0) nav.setAppBadge?.(unread).catch(() => {})
    else nav.clearAppBadge?.().catch(() => {})
  }, [unread])

  return <Context.Provider value={{ items, unread, loading, error, offline, reload, markRead, ack, done }}>{children}</Context.Provider>
}
