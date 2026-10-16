import { FormEvent, useState } from 'react'
import { supabase } from '../lib/supabase'
import { logAction } from '../lib/audit'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error || !data.user) {
      setErr('Incorrect email or password.')
      setBusy(false)
      return
    }
    await logAction(data.user.id, 'sign_in')
    setBusy(false)
  }

  return (
    <div className="employee-shell" style={{ paddingTop: '4rem' }}>
      <div className="card">
        <h1>Sign in</h1>
        <p className="muted">This workspace is invite-only.</p>
        <form onSubmit={submit}>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label htmlFor="pw">Password</label>
          <input id="pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {err && <p className="error">{err}</p>}
          <button className="primary" style={{ marginTop: '1rem', width: '100%' }} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
