import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { logAction } from '../lib/audit'
import type { FileKind, FileRow, Profile } from '../types'

const kinds: Record<FileKind, string> = {
  gsheet: 'Google Sheet',
  gdoc: 'Google Doc',
  excel: 'Excel',
  word: 'Word',
  other: 'Other'
}

function sheetIdFrom(url: string) {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}

const rowLabel = { display: 'flex', gap: '0.5rem', alignItems: 'center', fontWeight: 400, margin: 0 } as const
const box = { width: 'auto', minHeight: 'auto' } as const

export default function Files() {
  const { profile } = useAuth()
  const [files, setFiles] = useState<FileRow[]>([])
  const [people, setPeople] = useState<Profile[]>([])
  const [teamNames, setTeamNames] = useState<string[]>([])
  const [links, setLinks] = useState<Record<string, string[]>>({})
  const [open, setOpen] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<FileKind>('gsheet')
  const [url, setUrl] = useState('')
  const [month, setMonth] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null)

  async function load() {
    const [f, p, a, t] = await Promise.all([
      supabase.from('files').select('*').order('created_at', { ascending: false }),
      supabase.from('profiles').select('*').eq('role', 'employee').eq('active', true).order('email'),
      supabase.from('assignments').select('file_id,user_id').limit(10000),
      supabase.from('teams').select('name').order('sort').order('name')
    ])
    setFiles((f.data ?? []) as FileRow[])
    setPeople((p.data ?? []) as Profile[])
    const map: Record<string, string[]> = {}
    ;(a.data ?? []).forEach((r: any) => {
      map[r.file_id] = map[r.file_id] ?? []
      map[r.file_id].push(r.user_id)
    })
    setLinks(map)
    setTeamNames((t.data ?? []).map((x: any) => x.name as string))
  }
  useEffect(() => {
    load()
  }, [])

  async function assignIds(fileId: string, ids: string[]) {
    if (ids.length === 0) return 0
    const { error } = await supabase
      .from('assignments')
      .upsert(ids.map((user_id) => ({ file_id: fileId, user_id })), { onConflict: 'file_id,user_id', ignoreDuplicates: true })
    if (error) {
      setMsg({ text: error.message, err: true })
      return 0
    }
    setLinks((prev) => ({ ...prev, [fileId]: Array.from(new Set([...(prev[fileId] ?? []), ...ids])) }))
    return ids.length
  }

  async function unassignIds(fileId: string, ids: string[]) {
    const { error } = await supabase.from('assignments').delete().eq('file_id', fileId).in('user_id', ids)
    if (error) {
      setMsg({ text: error.message, err: true })
      return
    }
    setLinks((prev) => ({ ...prev, [fileId]: (prev[fileId] ?? []).filter((x) => !ids.includes(x)) }))
  }

  async function toggleGroup(f: FileRow, label: string, ids: string[]) {
    setMsg(null)
    if (ids.length === 0) return setMsg({ text: `No active employees in ${label} yet.`, err: true })
    const have = new Set(links[f.id] ?? [])
    const full = ids.every((i) => have.has(i))
    if (full) {
      await unassignIds(f.id, ids)
      await logAction(profile!.id, 'unassign_file', f.id, { title: `${f.title} → ${label}` })
    } else {
      await assignIds(f.id, ids)
      await logAction(profile!.id, 'assign_file', f.id, { title: `${f.title} → ${label}` })
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    setMsg(null)
    let sheet_id: string | null = null
    if (kind === 'gsheet') {
      sheet_id = sheetIdFrom(url)
      if (!sheet_id) return setMsg({ text: 'That does not look like a Google Sheets link.', err: true })
    }
    const { data, error } = await supabase
      .from('files')
      .insert({ title, kind, url, sheet_id, month_label: month || null, created_by: profile!.id })
      .select()
      .single()
    if (error) return setMsg({ text: error.message, err: true })
    await logAction(profile!.id, 'add_file', data.id, { title })
    const ids = people.filter((p) => (p.teams ?? []).some((t) => picked.includes(t))).map((p) => p.id)
    const n = await assignIds(data.id, ids)
    setMsg({ text: n > 0 ? `File added and shared with ${n} ${n === 1 ? 'person' : 'people'}.` : 'File added.', err: false })
    setTitle('')
    setUrl('')
    setMonth('')
    setPicked([])
    load()
  }

  async function remove(f: FileRow) {
    if (!confirm(`Remove "${f.title}" from the workspace? The original file is not deleted.`)) return
    await supabase.from('files').delete().eq('id', f.id)
    await logAction(profile!.id, 'remove_file', null, { title: f.title })
    load()
  }

  const needle = q.trim().toLowerCase()
  const shown = files.filter((f) => !needle || `${f.title} ${f.month_label ?? ''}`.toLowerCase().includes(needle))
  const allIds = people.map((p) => p.id)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Files</h1>
          <p className="muted" style={{ margin: 0 }}>Register your original files, then share each one with teams or people.</p>
        </div>
      </div>

      {msg && <div className={`notice${msg.err ? ' error' : ''}`}>{msg.text}</div>}

      <form className="card" onSubmit={add}>
        <h2>Add a file</h2>
        <div className="form-grid">
          <div>
            <label htmlFor="t">Title</label>
            <input id="t" value={title} onChange={(e) => setTitle(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="k">Type</label>
            <select id="k" value={kind} onChange={(e) => setKind(e.target.value as FileKind)}>
              {Object.entries(kinds).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="m">Month label (optional)</label>
            <input id="m" value={month} onChange={(e) => setMonth(e.target.value)} placeholder="October 2026" />
          </div>
        </div>
        <label htmlFor="u">Link</label>
        <input id="u" type="url" value={url} onChange={(e) => setUrl(e.target.value)} required />
        {teamNames.length > 0 && (
          <>
            <label>Share with teams right away (optional)</label>
            <div className="row">
              {teamNames.map((n) => (
                <label key={n} style={rowLabel}>
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
          </>
        )}
        <button className="primary" style={{ marginTop: '1rem' }}>Add file</button>
      </form>

      <input placeholder="Search files" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: '0.75rem' }} />

      {shown.length === 0 && <p className="muted">No files yet.</p>}
      {shown.map((f) => {
        const have = new Set(links[f.id] ?? [])
        const everyone = allIds.length > 0 && allIds.every((i) => have.has(i))
        return (
          <div key={f.id} className="card">
            <div className="row between">
              <div>
                <strong>{f.title}</strong>
                <div className="row" style={{ marginTop: '0.3rem', gap: '0.4rem' }}>
                  <span className="badge">{kinds[f.kind]}</span>
                  {f.month_label && <span className="muted">{f.month_label}</span>}
                  <span className="muted">· shared with {(links[f.id] ?? []).length}</span>
                </div>
              </div>
              <div className="actions">
                {f.kind === 'gsheet' && <Link className="btn small" to={`/file/${f.id}`}>View</Link>}
                {f.url && (
                  <a className="btn small" href={f.url} target="_blank" rel="noopener noreferrer">Open original</a>
                )}
                <button className={`small${open === f.id ? ' primary' : ''}`} onClick={() => setOpen(open === f.id ? null : f.id)}>
                  Share
                </button>
                <button className="small danger" onClick={() => remove(f)}>Remove</button>
              </div>
            </div>

            {open === f.id && (
              <div style={{ marginTop: '1rem' }}>
                <div className="chips">
                  <button className={`chip${everyone ? ' on' : ''}`} onClick={() => toggleGroup(f, 'everyone', allIds)}>
                    Everyone ({allIds.length})
                  </button>
                  {teamNames.map((n) => {
                    const ids = people.filter((p) => (p.teams ?? []).includes(n)).map((p) => p.id)
                    const full = ids.length > 0 && ids.every((i) => have.has(i))
                    return (
                      <button key={n} className={`chip${full ? ' on' : ''}`} onClick={() => toggleGroup(f, n, ids)}>
                        {full ? '✓ ' : ''}{n} ({ids.length})
                      </button>
                    )
                  })}
                </div>
                {people.length === 0 && <p className="muted">No active employees yet. Add some on the People page.</p>}
                {people.map((p) => (
                  <label key={p.id} style={{ ...rowLabel, padding: '0.3rem 0' }}>
                    <input type="checkbox" style={box} checked={have.has(p.id)} onChange={() => toggleGroup(f, p.email, [p.id])} />
                    <span>{p.full_name || p.email}</span>
                    {(p.teams ?? []).map((t) => (
                      <span key={t} className="badge">{t}</span>
                    ))}
                  </label>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
