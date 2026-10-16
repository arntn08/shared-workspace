import { FormEvent, useEffect, useState } from 'react'
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

export default function Files() {
  const { profile } = useAuth()
  const [files, setFiles] = useState<FileRow[]>([])
  const [people, setPeople] = useState<Profile[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [assigned, setAssigned] = useState<string[]>([])
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<FileKind>('gsheet')
  const [url, setUrl] = useState('')
  const [month, setMonth] = useState('')
  const [err, setErr] = useState('')

  async function load() {
    const f = await supabase.from('files').select('*').order('created_at', { ascending: false })
    setFiles((f.data ?? []) as FileRow[])
    const p = await supabase.from('profiles').select('*').eq('role', 'employee').eq('active', true).order('email')
    setPeople((p.data ?? []) as Profile[])
  }
  useEffect(() => {
    load()
  }, [])

  async function add(e: FormEvent) {
    e.preventDefault()
    setErr('')
    let sheet_id: string | null = null
    if (kind === 'gsheet') {
      sheet_id = sheetIdFrom(url)
      if (!sheet_id) {
        setErr('That does not look like a Google Sheets link.')
        return
      }
    }
    const { data, error } = await supabase
      .from('files')
      .insert({ title, kind, url, sheet_id, month_label: month || null, created_by: profile!.id })
      .select()
      .single()
    if (error) {
      setErr(error.message)
      return
    }
    await logAction(profile!.id, 'add_file', data.id, { title })
    setTitle('')
    setUrl('')
    setMonth('')
    load()
  }

  async function toggleOpen(id: string) {
    if (open === id) {
      setOpen(null)
      return
    }
    const a = await supabase.from('assignments').select('user_id').eq('file_id', id)
    setAssigned((a.data ?? []).map((r: any) => r.user_id))
    setOpen(id)
  }

  async function toggleAssign(fileId: string, userId: string) {
    if (assigned.includes(userId)) {
      await supabase.from('assignments').delete().eq('file_id', fileId).eq('user_id', userId)
      setAssigned(assigned.filter((x) => x !== userId))
      await logAction(profile!.id, 'unassign_file', fileId, { user_id: userId })
    } else {
      await supabase.from('assignments').insert({ file_id: fileId, user_id: userId })
      setAssigned([...assigned, userId])
      await logAction(profile!.id, 'assign_file', fileId, { user_id: userId })
    }
  }

  async function remove(f: FileRow) {
    if (!confirm(`Remove "${f.title}" from the workspace? The original file is not deleted.`)) return
    await supabase.from('files').delete().eq('id', f.id)
    await logAction(profile!.id, 'remove_file', null, { title: f.title })
    load()
  }

  return (
    <>
      <h1>Files</h1>
      <p className="muted">Register your original files, then choose who can see each one.</p>

      <form className="card" onSubmit={add}>
        <h2>Add a file</h2>
        <label htmlFor="t">Title</label>
        <input id="t" value={title} onChange={(e) => setTitle(e.target.value)} required />
        <label htmlFor="k">Type</label>
        <select id="k" value={kind} onChange={(e) => setKind(e.target.value as FileKind)}>
          {Object.entries(kinds).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <label htmlFor="u">Link</label>
        <input id="u" type="url" value={url} onChange={(e) => setUrl(e.target.value)} required />
        <label htmlFor="m">Month label (optional, e.g. October 2026)</label>
        <input id="m" value={month} onChange={(e) => setMonth(e.target.value)} />
        {err && <p className="error">{err}</p>}
        <button className="primary" style={{ marginTop: '1rem' }}>Add file</button>
      </form>

      {files.map((f) => (
        <div key={f.id} className="card">
          <div className="row between">
            <div>
              <strong>{f.title}</strong>
              <div className="row" style={{ marginTop: '0.25rem' }}>
                <span className="badge">{kinds[f.kind]}</span>
                {f.month_label && <span className="muted">{f.month_label}</span>}
              </div>
            </div>
          </div>
          <div className="row" style={{ marginTop: '0.75rem' }}>
            {f.kind === 'gsheet' && (
              <Link className="btn" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }} to={`/file/${f.id}`}>View</Link>
            )}
            {f.url && (
              <a className="btn" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }} href={f.url} target="_blank" rel="noopener noreferrer">Open original</a>
            )}
            <button onClick={() => toggleOpen(f.id)}>{open === f.id ? 'Close' : 'Assign'}</button>
            <button className="danger" onClick={() => remove(f)}>Remove</button>
          </div>
          {open === f.id && (
            <div style={{ marginTop: '0.75rem' }}>
              {people.length === 0 && <p className="muted">No active employees yet.</p>}
              {people.map((p) => (
                <label key={p.id} style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', fontWeight: 400 }}>
                  <input
                    type="checkbox"
                    style={{ width: 'auto', minHeight: 'auto' }}
                    checked={assigned.includes(p.id)}
                    onChange={() => toggleAssign(f.id, p.id)}
                  />
                  {p.full_name || p.email}
                </label>
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  )
}
