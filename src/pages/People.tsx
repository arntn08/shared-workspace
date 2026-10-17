import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { logAction } from '../lib/audit'
import { Avatar } from '../components/Nav'
import type { Profile } from '../types'

export default function People() {
  const { profile } = useAuth()
  const [list, setList] = useState<Profile[]>([])
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'employee' | 'editor'>('employee')
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    const { data } = await supabase.from('profiles').select('*').order('created_at')
    setList((data ?? []) as Profile[])
  }
  useEffect(() => {
    load()
  }, [])

  async function call(body: Record<string, unknown>) {
    const { data, error } = await supabase.functions.invoke('manage-user', { body })
    if (error || !data) return { ok: false, error: 'Could not reach the server.' }
    return data as { ok: boolean; error?: string }
  }

  async function create(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const res = await call({ action: 'create', email, password, full_name: name, role })
    setBusy(false)
    if (!res.ok) return setMsg({ text: res.error ?? 'Could not create the account.', err: true })
    setMsg({ text: `Account created for ${email}. Share the temporary password privately.`, err: false })
    setName('')
    setEmail('')
    setPassword('')
    load()
  }

  async function changeRole(p: Profile, r: string) {
    const res = await call({ action: 'set_role', userId: p.id, role: r })
    if (!res.ok) setMsg({ text: res.error ?? 'Could not change the role.', err: true })
    load()
  }

  async function resetPw(p: Profile) {
    const pw = window.prompt(`New temporary password for ${p.email} (at least 8 characters):`)
    if (!pw) return
    const res = await call({ action: 'set_password', userId: p.id, password: pw })
    setMsg({ text: res.ok ? `Password reset for ${p.email}.` : res.error ?? 'Could not reset the password.', err: !res.ok })
  }

  async function rename(p: Profile) {
    const n = window.prompt('Display name', p.full_name ?? '')
    if (n === null) return
    const res = await call({ action: 'rename', userId: p.id, full_name: n })
    if (!res.ok) setMsg({ text: res.error ?? 'Could not rename.', err: true })
    load()
  }

  async function setActive(p: Profile, active: boolean) {
    const text = active
      ? `Restore access for ${p.email}?`
      : `Revoke access for ${p.email}? They will no longer be able to see any data.`
    if (!confirm(text)) return
    await supabase.from('profiles').update({ active }).eq('id', p.id)
    await logAction(profile!.id, active ? 'restore_access' : 'revoke_access', null, { email: p.email })
    load()
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>People</h1>
          <p className="muted" style={{ margin: 0 }}>Add people, choose what they can do, and manage their access.</p>
        </div>
      </div>

      <form className="card" onSubmit={create}>
        <h2>Add a person</h2>
        <div className="form-grid">
          <div>
            <label htmlFor="n">Name</label>
            <input id="n" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label htmlFor="e">Email</label>
            <input id="e" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="p">Temporary password</label>
            <input id="p" type="text" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          </div>
          <div>
            <label htmlFor="r">Role</label>
            <select id="r" value={role} onChange={(e) => setRole(e.target.value as 'employee' | 'editor')}>
              <option value="employee">Employee (view assigned files)</option>
              <option value="editor">Editor (add files and edit cells)</option>
            </select>
          </div>
        </div>
        {msg && <p className={msg.err ? 'error' : 'muted'} style={{ marginTop: '0.75rem' }}>{msg.text}</p>}
        <button className="primary" style={{ marginTop: '1rem' }} disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
      </form>

      {list.map((p) => (
        <div key={p.id} className="card">
          <div className="person">
            <Avatar name={p.full_name} email={p.email} large />
            <div className="info">
              <strong>{p.full_name || p.email}</strong>
              <div className="muted">{p.email}{p.active ? '' : ' · access revoked'}</div>
            </div>
            {p.role === 'owner' || p.id === profile?.id ? (
              <span className={`role ${p.role}`}>{p.role}</span>
            ) : (
              <div className="actions">
                <select className="small" value={p.role} onChange={(e) => changeRole(p, e.target.value)}>
                  <option value="employee">Employee</option>
                  <option value="editor">Editor</option>
                </select>
                <button className="small" onClick={() => rename(p)}>Rename</button>
                <button className="small" onClick={() => resetPw(p)}>Reset password</button>
                {p.active ? (
                  <button className="small danger" onClick={() => setActive(p, false)}>Revoke</button>
                ) : (
                  <button className="small" onClick={() => setActive(p, true)}>Restore</button>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </>
  )
}
