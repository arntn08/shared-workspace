import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { logAction } from '../lib/audit'
import AngelScene from '../components/AngelScene'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error || !data.user) {
      const m = error?.message ?? ''
      setErr(/invalid login/i.test(m) ? 'Incorrect email or password.' : m || 'Sign in failed.')
      setBusy(false)
      return
    }
    await logAction(data.user.id, 'sign_in')
    setBusy(false)
  }

  return (
    <div className="login-stage">
      <AngelScene />
      <div className="login-card rise">
        <svg className="login-spark" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 1l2.2 8.8L23 12l-8.8 2.2L12 23l-2.2-8.8L1 12l8.8-2.2z" />
        </svg>
        <h1>Welcome back</h1>
        <p className="muted">Sign in to your shared workspace.</p>
        <form onSubmit={submit}>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label htmlFor="pw">Password</label>
          <div className="pw-wrap">
            <input
              id="pw"
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button type="button" className="pw-toggle" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'}>
              {show ? 'Hide' : 'Show'}
            </button>
          </div>
          {err && <p className="error" style={{ marginTop: '0.75rem' }}>{err}</p>}
          <button className="primary" style={{ marginTop: '1.25rem', width: '100%' }} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="login-foot">Secure · Private · Together</p>
      </div>
    </div>
  )
}
