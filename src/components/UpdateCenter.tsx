import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { parseDate, prettyDate, toIso } from '../lib/dates'
import type { FileRow, Profile } from '../types'
import '../components/tabs.css'

interface Rec {
  id: string
  name: string
  email: string
  access: boolean
  optedOut: boolean
  push: boolean
  mail: boolean
}
interface Preview {
  ok: boolean
  error?: string
  recipients?: Rec[]
  warnings?: string[]
  counts?: { send: number; optedOut: number; noAccess: number; push: number; email: number }
}

const line = { display: 'flex', gap: '0.5rem', alignItems: 'center', fontWeight: 400, margin: '0.2rem 0' } as const
const box = { width: 'auto', minHeight: 'auto' } as const

async function call(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('notify-update', { body })
  if (error || !data) return { ok: false, error: 'Could not reach the server.' } as any
  return data as any
}

export default function UpdateCenter() {
  const [files, setFiles] = useState<FileRow[]>([])
  const [teamNames, setTeamNames] = useState<string[]>([])
  const [people, setPeople] = useState<Profile[]>([])
  const [updates, setUpdates] = useState<any[]>([])
  const [notifs, setNotifs] = useState<any[]>([])
  const [changes, setChanges] = useState<Record<string, string>>({})

  const [fileId, setFileId] = useState('')
  const [dateIso, setDateIso] = useState('')
  const [action, setAction] = useState('')
  const [teams, setTeams] = useState<string[]>([])
  const [users, setUsers] = useState<string[]>([])
  const [remindAt, setRemindAt] = useState('')
  const [grant, setGrant] = useState(false)
  const [requestId, setRequestId] = useState(() => crypto.randomUUID())
  const [prev, setPrev] = useState<Preview | null>(null)
  const [prevSig, setPrevSig] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [q, setQ] = useState('')

  const file = files.find((f) => f.id === fileId)
  const hint = useMemo(() => (file ? parseDate(`${file.title} ${file.month_label ?? ''}`) : null), [file])
  const thisYear = new Date().getFullYear()

  async function load() {
    const [f, t, p, u, c] = await Promise.all([
      supabase.from('files').select('*').order('created_at', { ascending: false }),
      supabase.from('teams').select('name').order('sort'),
      supabase.from('profiles').select('*').eq('role', 'employee').eq('active', true).order('email'),
      supabase.from('file_updates').select('id,file_id,effective_date,action,remind_at,created_at,files(title)').order('created_at', { ascending: false }).limit(15),
      supabase.from('file_changes').select('file_id,last_change_at')
    ])
    setFiles((f.data ?? []) as FileRow[])
    setTeamNames((t.data ?? []).map((x: any) => x.name as string))
    setPeople((p.data ?? []) as Profile[])
    const ups = (u.data ?? []) as any[]
    setUpdates(ups)
    const m: Record<string, string> = {}
    ;(c.data ?? []).forEach((r: any) => {
      m[r.file_id] = r.last_change_at
    })
    setChanges(m)
    if (ups.length) {
      const n = await supabase
        .from('notifications')
        .select('id,update_id,kind,email_status,push_status,delivery_error,ack_at,done_at,profiles(email,full_name)')
        .in('update_id', ups.map((x) => x.id))
        .limit(5000)
      setNotifs(n.data ?? [])
    } else setNotifs([])
  }
  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    setPrev(null)
    setDateIso(hint?.year ? (toIso(hint.year, hint.month, hint.day) ?? '') : '')
  }, [fileId])

  const payload = {
    file_id: fileId,
    effective_date: dateIso,
    action_text: action.trim(),
    remind_at: remindAt ? new Date(remindAt).toISOString() : null,
    teams,
    users,
    grant_access: grant
  }
  const sig = JSON.stringify(payload)
  const ready = !!prev?.ok && prevSig === sig && !busy

  async function doPreview() {
    setMsg(null)
    if (!fileId || !dateIso) return setMsg({ text: 'Choose a file and confirm the date first.', err: true })
    setBusy(true)
    const res = await call({ action: 'preview', ...payload })
    setBusy(false)
    setPrev(res)
    setPrevSig(sig)
    if (!res.ok) setMsg({ text: res.error ?? 'Preview failed.', err: true })
  }

  async function doSend() {
    setBusy(true)
    const res = await call({ action: 'send', request_id: requestId, ...payload })
    setBusy(false)
    if (!res.ok) return setMsg({ text: res.error ?? 'Could not send.', err: true })
    setMsg({ text: res.duplicate ? 'This update was already sent. No duplicate was created.' : `Sent to ${res.notified} people.`, err: false })
    setRequestId(crypto.randomUUID())
    setPrev(null)
    setAction('')
    setRemindAt('')
    load()
  }

  async function retry(id: string) {
    const res = await call({ action: 'retry', update_id: id })
    setMsg({ text: res.ok ? 'Retrying failed deliveries.' : res.error ?? 'Could not retry.', err: !res.ok })
    window.setTimeout(load, 2500)
  }

  const stat = (uid: string) => {
    const rows = notifs.filter((n) => n.update_id === uid)
    const base = rows.filter((n) => n.kind === 'file_update')
    return {
      total: base.length,
      ack: base.filter((n) => n.ack_at).length,
      done: base.filter((n) => n.done_at).length,
      pushSent: rows.filter((n) => n.push_status === 'sent').length,
      mailSent: rows.filter((n) => n.email_status === 'sent').length,
      waiting: rows.filter((n) => ['pending', 'sending'].includes(n.push_status) || ['pending', 'sending'].includes(n.email_status)).length,
      failed: rows.filter((n) => n.push_status === 'failed' || n.email_status === 'failed')
    }
  }

  const shownPeople = people.filter((p) => !q || `${p.full_name ?? ''} ${p.email}`.toLowerCase().includes(q.toLowerCase()))
  const lastSent = (fid: string) => updates.find((x) => x.file_id === fid)?.created_at as string | undefined
  const changedFiles = files.filter((f) => changes[f.id] && (!lastSent(f.id) || changes[f.id] > lastSent(f.id)!))

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Updates</h1>
          <p className="muted" style={{ margin: 0 }}>Tell people a file changed, with a date and what they need to do.</p>
        </div>
      </div>

      {msg && <div className={`notice${msg.err ? ' error' : ''}`}>{msg.text}</div>}

      {changedFiles.length > 0 && (
        <div className="notice">
          Edited in the app since the last notice: {changedFiles.map((f) => f.title).join(', ')}.
          <button className="small" onClick={() => setFileId(changedFiles[0].id)}>Start an update</button>
        </div>
      )}

      <div className="card">
        <h2>New update</h2>
        <label htmlFor="uf">File</label>
        <select id="uf" value={fileId} onChange={(e) => setFileId(e.target.value)}>
          <option value="">Choose a file…</option>
          {files.map((f) => (
            <option key={f.id} value={f.id}>{f.title}</option>
          ))}
        </select>

        <label htmlFor="ud">Date this applies to</label>
        {hint && !hint.year && (
          <div className="row" style={{ marginBottom: '0.4rem' }}>
            <span className="muted">Found {new Date(2024, hint.month - 1, hint.day).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })} with no year. Confirm it:</span>
            <select className="small" value="" onChange={(e) => e.target.value && setDateIso(toIso(Number(e.target.value), hint.month, hint.day) ?? '')}>
              <option value="">Choose year…</option>
              {[thisYear - 1, thisYear, thisYear + 1].map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
        )}
        <input id="ud" type="date" value={dateIso} onChange={(e) => setDateIso(e.target.value)} />

        <label htmlFor="ua">Required action</label>
        <textarea id="ua" rows={2} maxLength={500} value={action} onChange={(e) => setAction(e.target.value)} placeholder="e.g. Check your rest day and confirm" />

        <label>Who should be notified?</label>
        <div className="chips">
          {teamNames.map((n) => (
            <button key={n} type="button" className={`chip${teams.includes(n) ? ' on' : ''}`} onClick={() => setTeams(teams.includes(n) ? teams.filter((x) => x !== n) : [...teams, n])}>
              {n}
            </button>
          ))}
        </div>
        <input placeholder="Search people" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: '0.4rem' }} />
        <div className="recip-list">
          {shownPeople.map((p) => (
            <label key={p.id} style={line}>
              <input type="checkbox" style={box} checked={users.includes(p.id)} onChange={() => setUsers(users.includes(p.id) ? users.filter((x) => x !== p.id) : [...users, p.id])} />
              {p.full_name || p.email}
            </label>
          ))}
        </div>
        <p className="muted" style={{ fontSize: '0.82rem' }}>Leave teams and people empty to notify everyone who can already open this file.</p>

        <label htmlFor="ur">Reminder (optional)</label>
        <input id="ur" type="datetime-local" value={remindAt} onChange={(e) => setRemindAt(e.target.value)} />
        <label style={{ ...line, marginTop: '0.8rem' }}>
          <input type="checkbox" style={box} checked={grant} onChange={(e) => setGrant(e.target.checked)} />
          Also share the file with recipients who cannot open it yet
        </label>

        <div className="row" style={{ marginTop: '1rem' }}>
          <button onClick={doPreview} disabled={busy}>Preview</button>
          <button className="primary" onClick={doSend} disabled={!ready}>{busy ? 'Working…' : 'Send'}</button>
        </div>

        {prev?.ok && prevSig === sig && (
          <div className="preview-box">
            <strong>{prev.counts?.send} will be notified</strong>
            <div className="muted" style={{ fontSize: '0.85rem' }}>
              {prev.counts?.push} by push · {prev.counts?.email} by email · {prev.counts?.optedOut} opted out · {prev.counts?.noAccess} without file access
            </div>
            {(prev.warnings ?? []).map((w, i) => (
              <p key={i} className="error" style={{ margin: '0.4rem 0 0', fontSize: '0.85rem' }}>{w}</p>
            ))}
            <div className="recip-list" style={{ marginTop: '0.6rem' }}>
              {(prev.recipients ?? []).map((r) => (
                <div key={r.id} style={{ fontSize: '0.85rem' }}>
                  {r.name} <span className="muted">{r.optedOut ? '· opted out' : !r.access && !grant ? '· no access' : ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h2>History and delivery</h2>
        {updates.length === 0 && <p className="muted">No updates sent yet.</p>}
        {updates.map((x) => {
          const s = stat(x.id)
          return (
            <div key={x.id} className="hist-row">
              <div className="row between">
                <strong>{x.files?.title ?? 'File'}</strong>
                <span className="muted" style={{ fontSize: '0.8rem' }}>{new Date(x.created_at).toLocaleString()}</span>
              </div>
              <div className="muted" style={{ fontSize: '0.85rem' }}>
                For {prettyDate(x.effective_date)}{x.action ? ` · ${x.action}` : ''}{x.remind_at ? ` · reminder ${new Date(x.remind_at).toLocaleString()}` : ''}
              </div>
              <div className="row" style={{ gap: '0.4rem', marginTop: '0.4rem' }}>
                <span className="badge">{s.total} recipients</span>
                <span className="badge edit">{s.ack} acknowledged</span>
                <span className="badge edit">{s.done} done</span>
                <span className="st sent">{s.pushSent} push · {s.mailSent} email sent</span>
                {s.waiting > 0 && <span className="st">{s.waiting} waiting</span>}
                {s.failed.length > 0 && <span className="st failed">{s.failed.length} failed</span>}
                {s.failed.length > 0 && (
                  <>
                    <button className="small" onClick={() => retry(x.id)}>Retry</button>
                    <button className="small" onClick={() => setOpen(open === x.id ? null : x.id)}>{open === x.id ? 'Hide' : 'Details'}</button>
                  </>
                )}
              </div>
              {open === x.id &&
                s.failed.map((n) => (
                  <div key={n.id} className="muted" style={{ fontSize: '0.82rem', marginTop: '0.3rem' }}>
                    {n.profiles?.full_name || n.profiles?.email}: {n.delivery_error ?? 'failed'}
                  </div>
                ))}
            </div>
          )
        })}
      </div>
    </>
  )
}
