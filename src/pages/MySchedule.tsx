import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { addLocalUpdate, ageLabel, cacheGet, cacheSet } from '../lib/offline'
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


function scheduleDateValue(label: string): string | null {
  const text = label.trim().toUpperCase().replace(/\\s+/g, ' ')
  const match = text.match(/^(?:([A-Z]+)\\s+)?([A-Z]{3,9})\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?$/)
  if (!match) return null
  const monthText = match[2] || match[1]
  const dayText = match[3]
  const yearText = match[4]
  const months: Record<string, number> = { JAN:0, JANUARY:0, FEB:1, FEBRUARY:1, MAR:2, MARCH:2, APR:3, APRIL:3, MAY:4, JUN:5, JUNE:5, JUL:6, JULY:6, AUG:7, AUGUST:7, SEP:8, SEPT:8, SEPTEMBER:8, OCT:9, OCTOBER:9, NOV:10, NOVEMBER:10, DEC:11, DECEMBER:11 }
  const month = months[monthText]
  if (month === undefined) return null
  const today = new Date()
  const year = yearText ? Number(yearText) : today.getFullYear()
  const date = new Date(year, month, Number(dayText))
  if (!yearText && date.getTime() < new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - 180 * 86400000) date.setFullYear(year + 1)
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
}
function tomorrowLocalIso() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}
function dateLabelIso(value: string) {
  const [y,m,d] = value.split('-').map(Number)
  return new Date(y, m-1, d).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }).toUpperCase()
}

interface Hit {
  section: string
  labels: string[]
  cells: string[]
}
interface Sheet {
  tabs: string[]
  tab: string
  rows: string[][]
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
  const uid = profile?.id as string | undefined
  const [files, setFiles] = useState<FileRow[]>([])
  const [fileId, setFileId] = useState('')
  const [tabs, setTabs] = useState<string[]>([])
  const [tab, setTab] = useState('')
  const [rows, setRows] = useState<string[][]>([])
  const [name, setName] = useState(profile?.full_name ?? '')
  const [busy, setBusy] = useState(true)
  const [err, setErr] = useState('')
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [selectedDate, setSelectedDate] = useState('')

  useEffect(() => {
    supabase
      .from('files')
      .select('*')
      .eq('kind', 'gsheet')
      .order('created_at', { ascending: false })
      .then(({ data, error }: any) => {
        let list = (data ?? []) as FileRow[]
        if (error && uid) list = cacheGet<FileRow[]>(uid, 'sched-files')?.data ?? []
        else if (uid) cacheSet(uid, 'sched-files', list)
        setFiles(list)
        if (list[0]) setFileId(list[0].id)
        else setBusy(false)
      })
  }, [])

  async function load(id: string, t: string) {
    setBusy(true)
    setErr('')
    setSavedAt(null)
    const { data, error } = await supabase.functions.invoke('read-sheet', { body: { fileId: id, tab: t || undefined } })
    const key = `sched:${id}:${t || '_'}`
    if (error || !data || data.error) {
      const c = uid ? cacheGet<Sheet>(uid, key) : null
      if (c) {
        setTabs(c.data.tabs)
        setTab(c.data.tab)
        setRows(c.data.rows)
        setSavedAt(c.at)
      } else setErr('Could not load the schedule.')
      setBusy(false)
      return
    }
    const sheet: Sheet = { tabs: data.tabs, tab: data.tab, rows: data.rows }
    setTabs(sheet.tabs)
    setTab(sheet.tab)
    setRows(sheet.rows)
    setBusy(false)
    if (!uid) return
    cacheSet(uid, key, sheet)
    // In-app update: tell the person when their own rows changed since the last time they looked.
    const own = profile?.full_name as string | undefined
    if (own && norm(own).length >= 3) {
      const mine = findHits(sheet.rows, own)
      const hitsKey = `hits:${id}:${sheet.tab}`
      const before = cacheGet<Hit[]>(uid, hitsKey)
      if (before && JSON.stringify(before.data) !== JSON.stringify(mine)) {
        const title = files.find((f) => f.id === id)?.title ?? 'the schedule'
        addLocalUpdate(uid, 'Your schedule changed', `${title} · ${sheet.tab}: your rows were updated. Please check them.`)
      }
      cacheSet(uid, hitsKey, mine)
    }
  }

  useEffect(() => {
    if (fileId) load(fileId, '')
  }, [fileId])

  const hits = useMemo(() => findHits(rows, name), [rows, name])
  const dateOptions = useMemo(() => {
    const unique = new Map<string, string>()
    for (const hit of hits) {
      const iso = scheduleDateValue(hit.section)
      if (iso) unique.set(iso, hit.section)
    }
    return [...unique.entries()].sort(([a], [b]) => {
      const tomorrow = tomorrowLocalIso()
      const da = a >= tomorrow ? a : `9999-${a}`
      const db = b >= tomorrow ? b : `9999-${b}`
      return da.localeCompare(db)
    })
  }, [hits])
  useEffect(() => {
    if (!dateOptions.length) { setSelectedDate(''); return }
    const tomorrow = tomorrowLocalIso()
    const defaultDate = dateOptions.find(([date]) => date >= tomorrow)?.[0] ?? dateOptions[0][0]
    setSelectedDate(current => dateOptions.some(([date]) => date === current) ? current : defaultDate)
  }, [dateOptions])
  const visibleHits = selectedDate ? hits.filter(hit => scheduleDateValue(hit.section) === selectedDate) : hits
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
      {savedAt && <div className="notice">Offline: showing your schedule saved {ageLabel(savedAt)}. It may be out of date.</div>}

      <div className="row" style={{ marginBottom: '0.75rem' }}>
        {dateOptions.length > 0 && <select aria-label="Schedule date" value={selectedDate} onChange={e => setSelectedDate(e.target.value)} style={{ flex: 1, minWidth: 160 }}>
          {dateOptions.map(([date, original]) => <option key={date} value={date}>{dateLabelIso(date)}{date === tomorrowLocalIso() ? ' · TOMORROW' : ''}</option>)}
        </select>}
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
      {!busy && !err && n.length >= 3 && visibleHits.length === 0 && (
        <p className="muted">
          No rows found for "{name}" in this sheet. Check the spelling, try another tab, or ask the owner to check your name on the People page.
        </p>
      )}

      {visibleHits.map((h, i) => {
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
