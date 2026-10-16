import { createContext, useContext, useEffect, useRef, useState, ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Profile } from '../types'

interface Ctx {
  session: Session | null
  profile: Profile | null
  loading: boolean
  signOut: () => Promise<void>
}

const AuthCtx = createContext<Ctx>(null as unknown as Ctx)
export const useAuth = () => useContext(AuthCtx)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)
  const loadedFor = useRef<string | null>(null)

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (!s) {
        loadedFor.current = null
        setProfile(null)
        setLoading(false)
        return
      }
      if (loadedFor.current === s.user.id) return
      setLoading(true)
      setTimeout(async () => {
        const { data: p } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', s.user.id)
          .maybeSingle()
        setProfile((p as Profile) ?? null)
        loadedFor.current = s.user.id
        setLoading(false)
      }, 0)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <AuthCtx.Provider value={{ session, profile, loading, signOut }}>
      {children}
    </AuthCtx.Provider>
  )
}
