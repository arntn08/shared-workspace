import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { applyPrefs, defaultPrefs, loadPrefs, savePrefs } from '../lib/prefs'
import { logAction } from '../lib/audit'
import { Avatar } from '../components/Nav'
import type { Prefs } from '../types'

const sizes = [
  { l: 'Small', v: 0.9 },
  { l: 'Normal', v: 1 },
  { l: 'Large', v: 1.2 },
  { l: 'Extra large', v: 1.4 }
]

export default function Settings() {
  const { profile, signOut } = useAuth()
  const [p, setP] = useState<Prefs>(defaultPrefs)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null)

  useEffect(() => {
    if (profile) loadPrefs(profile.id).then(setP)
  }, [profile?.id])

  async function update(next: Prefs) {
    setP(next)
    applyPrefs(next)
    await savePrefs(profile!.id, next)
  }

  async function changePw(e: FormEvent) {
    e.preventDefault()
    if (pw.length < 8) return setMsg({ text: 'Use at least 8 characters.', err: true })
    if (pw !== pw2) return setMsg({ text: 'The two passwords do not match.', err: true })
    const { error } = await supabase.auth.updateUser({ password: pw })
    if (error) return setMsg({ text: error.message, err: true })
    await logAction(profile!.id, 'change_password')
    setPw('')
    setPw2('')
    setMsg({ text: 'Password updated.', err: false })
  }

  return (
    <>
      <h1>Settings</h1>

      <div className="card">
        <div className="person">
          <Avatar name={profile?.full_name} email={profile?.email} large />
          <div className="info">
            <strong>{profile?.full_name || profile?.email}</strong>
            <div className="muted">{profile?.email}</div>
          </div>
          <span className={`role ${profile?.role}`}>{profile?.role}</span>
        </div>
      </div>

      <div className="card">
        <h2>Appearance</h2>
        <label>Text size</label>
        <div className="row">
          {sizes.map((s) => (
            <button key={s.v} className={`small${p.text_scale === s.v ? ' primary' : ''}`} onClick={() => update({ ...p, text_scale: s.v })}>
              {s.l}
            </button>
          ))}
        </div>
        <label htmlFor="th">Theme</label>
        <select id="th" value={p.theme} onChange={(e) => update({ ...p, theme: e.target.value as Prefs['theme'] })}>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
        <label htmlFor="ct">Contrast</label>
        <select id="ct" value={p.contrast} onChange={(e) => update({ ...p, contrast: e.target.value as Prefs['contrast'] })}>
          <option value="normal">Normal</option>
          <option value="high">High</option>
        </select>
      </div>

      <form className="card" onSubmit={changePw}>
        <h2>Change password</h2>
        <div className="form-grid">
          <div>
            <label htmlFor="pw">New password</label>
            <input id="pw" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />
          </div>
          <div>
            <label htmlFor="pw2">Repeat it</label>
            <input id="pw2" type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          </div>
        </div>
        {msg && <p className={msg.err ? 'error' : 'muted'} style={{ marginTop: '0.75rem' }}>{msg.text}</p>}
        <button className="primary" style={{ marginTop: '1rem' }}>Update password</button>
      </form>

      <div className="card">
        <h2>About access</h2>
        <p className="muted">
          Files are shown only to the people they are assigned to. No website can fully prevent screenshots or copying, so treat anything on screen as visible to the person viewing it. Access is logged.
        </p>
      </div>
      <button onClick={signOut}>Sign out</button>
    </>
  )
}
