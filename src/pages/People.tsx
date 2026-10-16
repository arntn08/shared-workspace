import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { logAction } from '../lib/audit'
import type { Profile } from '../types'

export default function People() {
  const { profile } = useAuth()
  const [list, setList] = useState<Profile[]>([])

  async function load() {
    const { data } = await supabase.from('profiles').select('*').order('created_at')
    setList((data ?? []) as Profile[])
  }
  useEffect(() => {
    load()
  }, [])

  async function setActive(p: Profile, active: boolean) {
    const msg = active
      ? `Restore access for ${p.email}?`
      : `Revoke access for ${p.email}? They will no longer be able to see any data.`
    if (!confirm(msg)) return
    await supabase.from('profiles').update({ active }).eq('id', p.id)
    await logAction(profile!.id, active ? 'restore_access' : 'revoke_access', null, { email: p.email })
    load()
  }

  return (
    <>
      <h1>People & Access</h1>
      <div className="notice">
        To add an employee: in Supabase go to Authentication → Users → Add user → Create new user, enter their email and a password, and tick Auto Confirm User. They appear here automatically.
      </div>
      {list.map((p) => (
        <div key={p.id} className="card">
          <div className="row between">
            <div>
              <strong>{p.full_name || p.email}</strong>
              <div className="muted">{p.email}</div>
              <div className="row" style={{ marginTop: '0.25rem' }}>
                <span className="badge">{p.role}</span>
                <span className="muted">{p.active ? 'Active' : 'Access revoked'}</span>
              </div>
            </div>
            {p.id !== profile?.id &&
              (p.active ? (
                <button className="danger" onClick={() => setActive(p, false)}>Revoke</button>
              ) : (
                <button onClick={() => setActive(p, true)}>Restore</button>
              ))}
          </div>
        </div>
      ))}
    </>
  )
}
