import { useRef, useState } from 'react'
import type { FormEvent, PointerEvent } from 'react'
import { supabase } from '../lib/supabase'
import { logAction } from '../lib/audit'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const card = useRef<HTMLDivElement>(null)

  function move(e: PointerEvent<HTMLDivElement>) {
    const el = card.current
    if (!el) return
    const x = e.clientX / window.innerWidth - 0.5
    const y = e.clientY / window.innerHeight - 0.5
    el.style.setProperty('--ry', `${x * 14}deg`)
    el.style.setProperty('--rx', `${-y * 14}deg`)
  }
  function leave() {
    const el = card.current
    if (!el) return
    el.style.setProperty('--rx', '0deg')
    el.style.setProperty('--ry', '0deg')
  }

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
    <div className="login-stage" onPointerMove={move} onPointerLeave={leave}>
      <div className="glow one" />
      <div className="glow two" />
      <div className="topo">
        <div className="topo-plane">
          <i /><i /><i /><i /><i /><i /><i />
        </div>
      </div>

      <div className="login-card rise" ref={card}>
        <div className="login-mark">W</div>
        <h1>Welcome back</h1>
        <p className="muted">This workspace is invite-only.</p>
        <form onSubmit={submit}>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <label htmlFor="pw">Password</label>
          <input id="pw" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          {err && <p className="error" style={{ marginTop: '0.75rem' }}>{err}</p>}
          <button className="primary" style={{ marginTop: '1.25rem', width: '100%' }} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
