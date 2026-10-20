import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { FileRow } from '../types'

const ERR = /^#(REF|N\/A|VALUE|DIV\/0|NAME|NULL|NUM|ERROR)[!?]?$/i
const NUM = /^[\d.,\s]+$/
const LABEL = /^(new install|migration|slr|total)$/i
const clean = (c: unknown) => {
  const s = String(c ?? '')
  return ERR.test(s.trim()) ? '' : s
}
const filled = (c: string | undefined) => (c ?? '').trim() !== ''
const norm = (s: string) => s.replace(/\*/g, '').replace(/\s+/g, ' ').trim().toUpperCase()

function isHeading(cells: string[]) {
  const text = cells.filter((c) => filled(c))
  if (text.length === 0) return false
  const first = text[0].trim()
  if (NUM.test(first) || /^total\b/i.test(first)) return false
  return text.slice(1).every((c) => NUM.test(c.trim()) || LABEL.test(c.trim()))
}

interface Hit {
  section: string
  labels: string[]
  cells: string[]
}

function findHits(rows: string[][], needle: string): Hit[] {
  const n = norm(needle)
  if (n.length < 3) return []
  const hits: Hit[] = []
  let section = ''
  let head: string[] = []
  let expectHead = false
  let seenTitle = false
  for (const raw of rows) {
    const cells = (Array.isArray(raw) ? raw : []).map((c) => clean(c))
    if (!cells.some((c) => filled(c))) continue
    if (isHeading(cells)) {
      const text = (cells.find((c) => filled(c)) ?? '').trim()
      if (!seenTitle) {
        seenTitle = true
        continue
      }
      section = text
      head = []
      expectHead = true
      continue
    }
    if (expectHead) {
      head = cells
      expectHead = false
      continue
    }
    if (cells.some((c) => filled(c) && norm(c).includes(n))) hits.push({ section, labels: head, cells })
  }
  return hits
}

export default function MySchedule() {
  const { profile } = useAuth()
  const [files, setFiles] = useState<FileRow[]>([])
  const [fileId, setFileId] = useState('')
  const [tabs, setTabs] = useState<string[]>([])
  const [tab, setTab] = useState('')
  const [rows, setRows] = useState<string[][]>([])
  const [name, setName] = useState(profile?.full_name ?? '')
  const [busy, setBusy] = useState(true)
  const [err, setErr] = useState('')

  async function load(id: string, t: string) {
    setBusy(true)
    setErr('')
    const { data, error } = await supabase.functions.invoke('read-sheet', {
      body: { fileId: id, tab: t || undefined }
    })
    if (error || !data || data.error) {
      setErr('Could not load the schedule.')
      setBusy(false)
      return
    }
    setTabs(data.tabs)
    setTab(data.tab)
    setRows(data.rows)
    setBusy(false)
  }

  useEffect(() => {
    supabase
      .from('files')
      .select('*')
      .eq('kind', 'gsheet')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        const list = (data ?? []) as FileRow[]
        setFiles(list)
        if (list[0]) setFileId(list[0].id)
        else setBusy(false)
      })
  }, [])

  useEffect(() => {
    if (fileId) load(fileId, '')
  }, [fileId])

  const hits = useMemo(() => findHits(rows, name), [rows, name])
  const n = norm(name)

  return (
    <>
      <div className="page-head">
        <div>
          <h1>My schedule</h1>
          <p className="muted" style={{ margin: 0 }}>Your rows from the sheet, pulled out so you do not have to hunt for your name.</p>
        </div>
      </div>

      {!profile?.full_name && (
        <div className="notice">Your account has no name saved yet. Type your name below, and ask the owner to set it on the People page.</div>
      )}

      <div className="row" style={{ marginBottom: '0.75rem' }}>
        {files.length > 1 && (
          <select value={fileId} onChange={(e) => setFileId(e.target.value)} style={{ flex: 1, minWidth: 160 }}>
            {files.map((f) => (
              <option key={f.id} value={f.id}>{f.title}</option>
            ))}
          </select>
        )}
        {tabs.length > 1 && (
          <select value={tab} onChange={(e) => load(fileId, e.target.value)} style={{ flex: 1, minWidth: 140 }}>
            {tabs.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        )}
        <input placeholder="Search a name" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 2, minWidth: 200 }} />
      </div>

      {busy && <p className="muted">Loading…</p>}
      {err && <p className="error">{err}</p>}
      {!busy && !err && files.length === 0 && <p className="muted">No spreadsheets are shared with you yet.</p>}
      {!busy && !err && files.length > 0 && n.length < 3 && <p className="muted">Type at least 3 letters of a name to search.</p>}
      {!busy && !err && n.length >= 3 && hits.length === 0 && (
        <p className="muted">
          No rows found for "{name}" in this sheet. Check the spelling, try another tab, or ask the owner to check your name on the People page.
        </p>
      )}

      {hits.map((h, i) => {
        const cols = h.cells.map((_, ci) => ci).filter((ci) => filled(h.cells[ci]))
        const mine = cols.find((ci) => norm(h.cells[ci]).includes(n))
        const role = mine !== undefined ? h.labels[mine] : ''
        return (
          <div key={i} className="sheet-card" style={{ marginBottom: '0.75rem' }}>
            <div className="sheet-card-title">
              {h.section || 'Schedule'}
              {role ? ` · ${role}` : ''}
            </div>
            <div className="sheet-card-grid">
              {cols.map((ci) => (
                <div key={ci}>
                  <span>{h.labels[ci] ?? ''}</span>
                  <b style={ci === mine ? { color: 'var(--accent)' } : undefined}>{h.cells[ci]}</b>
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </>
  )
}
