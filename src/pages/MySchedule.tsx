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
  const text = label.trim().toUpperCase().replace(/\s+/g, ' ')
  const match = text.match(/^([A-Z]{3,9})\s+(\d{1,2})(?:,?\s+(\d{4}))?$/)
  if (!match) return null
  const monthText = match[1]
  const dayText = match[2]
  const yearText = match[3]
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
  const [selectedHit, setSelectedHit] = useState<Hit | null>(null)

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
    const tomorrow = tomorrowLocalIso()
    return [...unique.entries()].sort(([a], [b]) => {
      const aFuture = a >= tomorrow
      const bFuture = b >= tomorrow
      if (aFuture !== bFuture) return aFuture ? -1 : 1
      return aFuture ? a.localeCompare(b) : b.localeCompare(a)
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
  // A status notice is shown only when the signed-in person's matching schedule row
  // explicitly contains a coding/rest-day status; never infer rest day from missing rows.
  const matchedStatus = visibleHits.flatMap(hit => hit.cells).map(value => norm(value))
  const isRestDay = matchedStatus.some(value => /^(REST\s*DAY|RESTDAY|REST)$/i.test(value))
  const isCodingDay = matchedStatus.some(value => /^(CODING|CODING\s*DAY)$/i.test(value))

  return (
    <>
      <style>{".owner-schedule-theme .sheet-card{border:1px solid #b9c9f4!important;border-radius:16px!important;background:linear-gradient(125deg,#edf3ff,#f7f9ff 52%,#e9eefe)!important;box-shadow:0 7px 22px rgba(37,67,130,.09);padding:.85rem!important;color:#18243b}.owner-schedule-theme .sheet-card-title{color:#1c376c;font-weight:800}.owner-schedule-theme .sheet-card-grid{display:grid;grid-template-columns:1fr!important;gap:.5rem!important}.owner-schedule-theme .sheet-card-grid>div{display:flex;flex-direction:column;gap:.22rem;border:1px solid #d3def8!important;border-radius:10px;background:linear-gradient(120deg,#fff,#edf3ff);padding:.55rem .65rem;min-width:0}.owner-schedule-theme .sheet-card-grid>div span{color:#536d9f;font-size:.72rem;font-weight:750;text-transform:uppercase;letter-spacing:.035em}.owner-schedule-theme .sheet-card-grid>div b{color:#17233a;overflow-wrap:anywhere;white-space:pre-wrap}.owner-schedule-theme .page-head h1{color:#172b52}.owner-schedule-theme .schedule-controls{border:1px solid #cbd7f4;border-radius:14px;padding:.65rem;background:linear-gradient(120deg,#f4f7ff,#edf1ff)}.owner-schedule-theme input,.owner-schedule-theme select{border-color:#c4d1f2;border-radius:10px}.owner-schedule-theme .sheet-card-button{width:100%;text-align:left;cursor:pointer;font:inherit;display:block;appearance:none}.owner-schedule-theme .sheet-card-button:focus-visible{outline:3px solid #5d82d8;outline-offset:2px}.owner-schedule-theme .schedule-modal-backdrop{position:fixed;inset:0;z-index:10000;background:rgba(8,14,28,.64);backdrop-filter:blur(7px);display:grid;place-items:center;padding:1rem}.owner-schedule-theme .schedule-modal{width:min(100%,560px);max-height:min(85vh,760px);overflow:auto;background:linear-gradient(145deg,#f7f9ff,#fff 60%,#eaf0ff);border:1px solid #c4d1f2;border-radius:22px;padding:1.1rem;box-shadow:0 24px 80px rgba(0,0,0,.3);color:#17233a}.owner-schedule-theme .schedule-modal-head{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;border-bottom:1px solid #d7e0f8;padding-bottom:.8rem;margin-bottom:.75rem}.owner-schedule-theme .schedule-modal h2{margin:0;color:#1c376c;font-size:1.2rem}.owner-schedule-theme .schedule-modal-close{width:38px;height:38px;border:1px solid #c4d1f2;border-radius:12px;background:#eaf0ff;color:#24457f;font-size:1.5rem;cursor:pointer}.owner-schedule-theme .schedule-modal-lines{display:grid;grid-template-columns:1fr!important;gap:.55rem!important}.owner-schedule-theme .schedule-modal-line{display:flex;flex-direction:column;gap:.25rem;padding:.7rem .75rem;border:1px solid #d3def8;border-radius:12px;background:linear-gradient(110deg,#fff,#f1f5ff);overflow-wrap:anywhere}.owner-schedule-theme .schedule-modal-line span{font-size:.72rem;font-weight:750;letter-spacing:.04em;text-transform:uppercase;color:#536d9f}.owner-schedule-theme .schedule-modal-line strong{font-size:.95rem;color:#17233a;white-space:pre-wrap;overflow-wrap:anywhere}[data-theme=dark] .owner-schedule-theme .sheet-card{background:linear-gradient(125deg,#151d30,#1b2740 55%,#222943)!important;border-color:#3c568b!important;color:#e7edff}[data-theme=dark] .owner-schedule-theme .sheet-card-title,[data-theme=dark] .owner-schedule-theme .page-head h1{color:#c9d9ff}[data-theme=dark] .owner-schedule-theme .sheet-card-grid>div{background:linear-gradient(120deg,#1c2942,#222d48);border-color:#3c568b!important}[data-theme=dark] .owner-schedule-theme .sheet-card-grid>div span{color:#a9c0f5}[data-theme=dark] .owner-schedule-theme .sheet-card-grid>div b{color:#f0f4ff}[data-theme=dark] .owner-schedule-theme .schedule-controls{background:linear-gradient(120deg,#151d30,#202943);border-color:#3c568b}[data-theme=dark] .owner-schedule-theme .schedule-modal{background:linear-gradient(145deg,#151d30,#202943);border-color:#3c568b;color:#f0f4ff}[data-theme=dark] .owner-schedule-theme .schedule-modal h2{color:#c9d9ff}[data-theme=dark] .owner-schedule-theme .schedule-modal-line{background:linear-gradient(110deg,#1c2942,#222d48);border-color:#3c568b}[data-theme=dark] .owner-schedule-theme .schedule-modal-line strong{color:#f0f4ff}[data-theme=dark] .owner-schedule-theme .schedule-modal-line span{color:#a9c0f5}"}</style>
      <div className="owner-schedule-theme">
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

      <div className="row schedule-controls" style={{ marginBottom: '0.75rem' }}>
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
      {!busy && !err && isRestDay && (
        <div role="status" aria-live="polite" className="notice" style={{ border: '1px solid #b9d8c4', background: 'linear-gradient(120deg, rgba(34,197,94,.13), rgba(16,185,129,.07))', borderRadius: 14, padding: '1rem', marginBottom: '.8rem' }}>
          <strong>🌿 Rest day</strong>
          <div>You are marked as REST DAY on the selected schedule. Enjoy your day off!</div>
        </div>
      )}
      {!busy && !err && !isRestDay && isCodingDay && (
        <div role="status" aria-live="polite" className="notice" style={{ border: '1px solid #bfd2f7', background: 'linear-gradient(120deg, rgba(59,130,246,.12), rgba(99,102,241,.07))', borderRadius: 14, padding: '1rem', marginBottom: '.8rem' }}>
          <strong>🖥️ Coding day</strong>
          <div>You are marked for CODING on the selected schedule.</div>
        </div>
      )}
      {!busy && !err && files.length === 0 && <p className="muted">No spreadsheets are shared with you yet.</p>}
      {!busy && !err && files.length > 0 && n.length < 3 && <p className="muted">Type at least 3 letters of a name to search.</p>}
      {!busy && !err && n.length >= 3 && visibleHits.length === 0 && (
        <div className="notice" role="status" aria-live="polite" style={{ borderRadius: 14, padding: '1rem' }}>
          <strong>Schedule not listed</strong>
          <p style={{ margin: '.35rem 0 0' }}>We couldn't find a schedule row for "{name}" on this sheet/date. This does not automatically mean you are on rest day. Try another tab or date, or ask the workspace owner to confirm your schedule on the People page.</p>
        </div>
      )}

      {visibleHits.map((h, i) => {
        const cols = h.cells.map((_, ci) => ci).filter((ci) => filled(h.cells[ci]))
        const mine = cols.find((ci) => norm(h.cells[ci]).includes(n))
        const role = mine !== undefined ? h.labels[mine] : ''
        return (
          <button type="button" key={i} className="sheet-card sheet-card-button" aria-label={`View schedule details for ${h.section || "schedule"}`} onClick={() => setSelectedHit(h)} style={{ marginBottom: '0.75rem' }}>
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
          </button>
        )
      })}
      {selectedHit && <div className="schedule-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setSelectedHit(null) }}><section className="schedule-modal" role="dialog" aria-modal="true" aria-labelledby="my-schedule-modal-title"><div className="schedule-modal-head"><div><div style={{fontSize:'.72rem',letterSpacing:'.12em',textTransform:'uppercase',fontWeight:800,color:'#536d9f',marginBottom:'.3rem'}}>Schedule details</div><h2 id="my-schedule-modal-title">{selectedHit.section || 'Schedule'}</h2></div><button type="button" className="schedule-modal-close" onClick={() => setSelectedHit(null)} aria-label="Close schedule details">×</button></div><div className="schedule-modal-lines">{selectedHit.cells.map((value, ci) => value.trim() ? <div className="schedule-modal-line" key={ci}><span>{selectedHit.labels[ci] || 'Detail ' + (ci + 1)}</span><strong>{value}</strong></div> : null)}</div></section></div>}
      </div>
    </>
  )
}
