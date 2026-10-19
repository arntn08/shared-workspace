import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { logAction } from '../lib/audit'
import { Avatar } from '../components/Nav'
import type { Profile } from '../types'

interface Result {
  email: string
  ok: boolean
  error?: string
  password?: string
  note?: string
}
interface Item {
  email: string
  full_name: string
  teams: string[]
  password: string
}

const row = { display: 'flex', gap: '0.5rem', alignItems: 'center', fontWeight: 400, margin: 0 } as const
const box = { width: 'auto', minHeight: 'auto' } as const

export default function People() {
  const { profile } = useAuth()
  const [list, setList] = useState<Profile[]>([])
  const [teamNames, setTeamNames] = useState<string[]>([])
  const [filter, setFilter] = useState('all')
  const [editing, setEditing] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [bulk, setBulk] = useState('')
  const [results, setResults] = useState<Result[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [newTeam, setNewTeam] = useState('')

  async function load() {
    const [p, t] = await Promise.all([
      supabase.from('profiles').select('*').order('created_at'),
      supabase.from('teams').select('name').order('sort').order('name')
    ])
    setList((p.data ?? []) as Profile[])
    setTeamNames((t.data ?? []).map((x: any) => x.name as string))
  }
  useEffect(() => {
    load()
  }, [])

  async function call(body: Record<string, unknown>) {
    const { data, error } = await supabase.functions.invoke('manage-user', { body })
    if (error || !data) return { ok: false, error: 'Could not reach the server.' } as { ok: boolean; error?: string; results?: Result[] }
    return data as { ok: boolean; error?: string; results?: Result[] }
  }

  function resolveTeam(raw: string) {
    const t = raw.trim().toLowerCase()
    if (!t) return ''
    const exact = teamNames.find((n) => n.toLowerCase() === t)
    if (exact) return exact
    const part = teamNames.filter((n) => n.toLowerCase().includes(t))
    return part.length === 1 ? part[0] : raw.trim()
  }

  async function createMany(items: Item[]) {
    setBusy(true)
    setMsg(null)
    setResults(null)
    const res = await call({ action: 'bulk_create', items })
    setBusy(false)
    if (!res.ok) {
      setMsg({ text: res.error ?? 'Could not create the accounts.', err: true })
      return false
    }
    setResults(res.results ?? [])
    load()
    return true
  }

  async function addOne(e: FormEvent) {
    e.preventDefault()
    const ok = await createMany([{ email, full_name: name, teams: picked, password }])
    if (ok) {
      setName('')
      setEmail('')
      setPassword('')
      setPicked([])
    }
  }

  async function addBulk(e: FormEvent) {
    e.preventDefault()
    const items: Item[] = bulk
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const parts = l.split(',').map((x) => x.trim())
        return {
          email: parts[0] ?? '',
          full_name: parts[1] ?? '',
          teams: (parts[2] ?? '').split(';').map(resolveTeam).filter(Boolean),
          password: parts[3] ?? ''
        }
      })
    if (items.length === 0) return setMsg({ text: 'Paste at least one line.', err: true })
    const ok = await createMany(items)
    if (ok) setBulk('')
  }

  async function copyLogins() {
    const text = (results ?? [])
      .filter((r) => r.ok && r.password)
      .map((r) => `${r.email} — ${r.password}`)
      .join('\n')
    try {
      await navigator.clipboard.writeText(text)
      setMsg({ text: 'Copied. Share each login privately.', err: false })
    } catch {
      setMsg({ text: 'Could not copy. Select the text instead.', err: true })
    }
  }

  async function saveTeams(p: Profile, teams: string[]) {
    const res = await call({ action: 'set_teams', userId: p.id, teams })
    if (!res.ok) setMsg({ text: res.error ?? 'Could not save teams.', err: true })
    load()
  }

  async function addTeam(e: FormEvent) {
    e.preventDefault()
    const n = newTeam.trim()
    if (!n) return
    const { error } = await supabase.from('teams').insert({ name: n, sort: teamNames.length + 1 })
    if (error) return setMsg({ text: error.message, err: true })
    setNewTeam('')
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

  const shown = list.filter((p) =>
    filter === 'all' ? true : filter === 'none' ? (p.teams ?? []).length === 0 : (p.teams ?? []).includes(filter)
  )

  return (
    <>
      <div className="page-head">
        <div>
          <h1>People</h1>
          <p className="muted" style={{ margin: 0 }}>Add people, put them in teams, and manage their access.</p>
        </div>
      </div>

      {msg && <div className={`notice${msg.err ? ' error' : ''}`}>{msg.text}</div>}

      {results && (
        <div className="card">
          <div className="row between">
            <h2 style={{ margin: 0 }}>Results</h2>
            <div className="actions">
              {results.some((r) => r.password) && <button className="small" onClick={copyLogins}>Copy logins</button>}
              <button className="small" onClick={() => setResults(null)}>Close</button>
            </div>
          </div>
          <p className="muted">Passwords are shown once. Share each one privately and ask people to change it in Settings.</p>
          {results.map((r, i) => (
            <div key={i} className="feed-item">
              <span className={`dot ${r.ok ? 'edit' : 'admin'}`} />
              <div>
                <div>{r.email}</div>
                <div className="muted" style={{ fontSize: '0.85rem' }}>
                  {r.ok ? (r.password ? `Created. Temporary password: ${r.password}` : r.note ?? 'Done.') : r.error}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <form className="card" onSubmit={addOne}>
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
            <label htmlFor="p">Temporary password (blank = generate one)</label>
            <input id="p" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        </div>
        <label>Teams</label>
        <div className="row">
          {teamNames.map((n) => (
            <label key={n} style={row}>
              <input
                type="checkbox"
                style={box}
                checked={picked.includes(n)}
                onChange={() => setPicked(picked.includes(n) ? picked.filter((x) => x !== n) : [...picked, n])}
              />
              {n}
            </label>
          ))}
        </div>
        <button className="primary" style={{ marginTop: '1rem' }} disabled={busy}>{busy ? 'Working…' : 'Create account'}</button>
      </form>

      <form className="card" onSubmit={addBulk}>
        <h2>Bulk add</h2>
        <p className="muted">
          One person per line: email, name, teams (separate teams with ;), password (optional). A short team name like "cielo" or "nap" works if it matches only one team. If the email already has an account, only the teams are added.
        </p>
        <textarea
          rows={6}
          value={bulk}
          onChange={(e) => setBulk(e.target.value)}
          placeholder={'ahba.alvin@gmail.com, Ahba Alvin, Cielo; QA\nsomeone@gmail.com, Some One, NAP Audit Team'}
        />
        <button className="primary" style={{ marginTop: '1rem' }} disabled={busy}>{busy ? 'Working…' : 'Create all'}</button>
      </form>

      <form className="card" onSubmit={addTeam}>
        <h2>Teams</h2>
        <div className="row">
          {teamNames.map((n) => (
            <span key={n} className="badge">{n}</span>
          ))}
        </div>
        <div className="row" style={{ marginTop: '0.75rem' }}>
          <input placeholder="New team name" value={newTeam} onChange={(e) => setNewTeam(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
          <button className="small">Add team</button>
        </div>
      </form>

      <div className="chips">
        <button className={`chip${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>All ({list.length})</button>
        {teamNames.map((n) => (
          <button key={n} className={`chip${filter === n ? ' on' : ''}`} onClick={() => setFilter(n)}>
            {n} ({list.filter((p) => (p.teams ?? []).includes(n)).length})
          </button>
        ))}
        <button className={`chip${filter === 'none' ? ' on' : ''}`} onClick={() => setFilter('none')}>No team</button>
      </div>

      {shown.map((p) => (
        <div key={p.id} className="card">
          <div className="person">
            <Avatar name={p.full_name} email={p.email} large />
            <div className="info">
              <strong>{p.full_name || p.email}</strong>
              <div className="muted">{p.email}{p.active ? '' : ' · access revoked'}</div>
              <div className="row" style={{ marginTop: '0.35rem', gap: '0.35rem' }}>
                {(p.teams ?? []).map((t) => (
                  <span key={t} className="badge">{t}</span>
                ))}
              </div>
            </div>
            {p.role === 'owner' || p.id === profile?.id ? (
              <span className={`role ${p.role}`}>{p.role}</span>
            ) : (
              <div className="actions">
                <select className="small" value={p.role} onChange={(e) => changeRole(p, e.target.value)}>
                  <option value="employee">Employee</option>
                  <option value="editor">Editor</option>
                </select>
                <button className="small" onClick={() => setEditing(editing === p.id ? null : p.id)}>Teams</button>
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
          {editing === p.id && (
            <div className="row" style={{ marginTop: '0.9rem' }}>
              {teamNames.map((n) => {
                const has = (p.teams ?? []).includes(n)
                return (
                  <label key={n} style={row}>
                    <input
                      type="checkbox"
                      style={box}
                      checked={has}
                      onChange={() => saveTeams(p, has ? (p.teams ?? []).filter((x) => x !== n) : [...(p.teams ?? []), n])}
                    />
                    {n}
                  </label>
                )
              })}
            </div>
          )}
        </div>
      ))}
      {shown.length === 0 && <p className="muted">Nobody here yet.</p>}
    </>
  )
}
