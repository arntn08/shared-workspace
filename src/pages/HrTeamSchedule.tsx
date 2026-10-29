import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { FileRow } from '../types'

type Sheet = { tabs: string[]; tab: string; rows: string[][] }
type Section = { title: string; headers: string[]; rows: string[][] }
const ERR = /^#(REF|N\/A|VALUE|DIV\/0|NAME|NULL|NUM|ERROR)[!?]?$/i
const NUM = /^[\d.,\s]+$/
const LABEL = /^(new install|migration|slr|total)$/i
const clean = (v: unknown) => { const s = String(v ?? '').trim(); return ERR.test(s) ? '' : s }
const filled = (v?: string) => Boolean((v ?? '').trim())
function isHeading(cells: string[]) {
  const values = cells.filter(filled)
  if (!values.length) return false
  if (NUM.test(values[0]) || /^total\b/i.test(values[0])) return false
  return values.slice(1).every(v => NUM.test(v) || LABEL.test(v))
}
function parseSections(rows: string[][]): Section[] {
  const sections: Section[] = []
  let title = 'Schedule', headers: string[] = [], body: string[][] = [], seenTitle = false, expectHeaders = false
  const flush = () => { if (body.length) sections.push({ title, headers, rows: body }); body = [] }
  for (const raw of rows) {
    const cells = (Array.isArray(raw) ? raw : []).map(clean)
    if (!cells.some(filled)) continue
    if (isHeading(cells)) {
      flush()
      const label = cells.find(filled) || ''
      if (!seenTitle) { seenTitle = true; title = label; continue }
      title = label; headers = []; expectHeaders = true; continue
    }
    if (expectHeaders) { headers = cells; expectHeaders = false; continue }
    if (!headers.length) headers = cells.map((_, i) => 'Column ' + (i + 1))
    body.push(cells)
  }
  flush()
  return sections
}
export default function HrTeamSchedule() {
  const [files,setFiles] = useState<FileRow[]>([])
  const [fileId,setFileId] = useState('')
  const [tabs,setTabs] = useState<string[]>([])
  const [tab,setTab] = useState('')
  const [rows,setRows] = useState<string[][]>([])
  const [search,setSearch] = useState('')
  const [dateFilter,setDateFilter] = useState('all')
  const [busy,setBusy] = useState(true)
  const [error,setError] = useState('')
  useEffect(() => {
    let alive = true
    supabase.from('files').select('*').eq('kind','gsheet').order('created_at',{ascending:false}).then(({data,error}: any) => {
      if (!alive) return
      if (error) setError(error.message)
      const list = (data ?? []) as FileRow[]
      setFiles(list)
      if (list[0]) setFileId(list[0].id); else setBusy(false)
    })
    return () => { alive = false }
  }, [])
  async function load(id:string,t?:string) {
    setBusy(true); setError('')
    const {data,error:err} = await supabase.functions.invoke('read-sheet',{body:{fileId:id,tab:t || undefined}})
    if (err || !data || data.error) { setError(err?.message || data?.error || 'Could not load the shared schedule.'); setBusy(false); return }
    setTabs(data.tabs ?? []); setTab(data.tab ?? t ?? ''); setRows(data.rows ?? []); setBusy(false)
  }
  useEffect(()=>{ if(fileId) void load(fileId) },[fileId])
  const sections = useMemo(()=>parseSections(rows),[rows])
  const dates = useMemo(()=>sections.map(s=>s.title).filter((v,i,a)=>a.indexOf(v)===i),[sections])
  const visible = sections.filter(s=>(dateFilter==='all'||s.title===dateFilter)&&(!search.trim()||s.title.toLowerCase().includes(search.toLowerCase())||s.rows.some(r=>r.some(c=>c.toLowerCase().includes(search.toLowerCase())))))
  const count = visible.reduce((sum,s)=>sum+s.rows.length,0)
  return <>
    <div className="page-head"><div><h1>Team schedules</h1><p className="muted" style={{margin:0}}>All shared team schedules in a compact calendar-style overview.</p></div><button className="small" onClick={()=>fileId&&void load(fileId,tab)}>Refresh</button></div>
    <div className="row" style={{gap:'.55rem',marginBottom:'.75rem',flexWrap:'wrap'}}>
      {files.length>1&&<select aria-label="Schedule spreadsheet" value={fileId} onChange={e=>setFileId(e.target.value)} style={{flex:'1 1 220px'}}>{files.map(f=><option key={f.id} value={f.id}>{f.title}</option>)}</select>}
      {tabs.length>1&&<select aria-label="Schedule tab" value={tab} onChange={e=>void load(fileId,e.target.value)} style={{flex:'1 1 160px'}}>{tabs.map(t=><option key={t} value={t}>{t}</option>)}</select>}
      <select aria-label="Filter schedule date" value={dateFilter} onChange={e=>setDateFilter(e.target.value)} style={{flex:'1 1 150px'}}><option value="all">All dates</option>{dates.map(d=><option key={d} value={d}>{d}</option>)}</select>
      <input aria-label="Search schedules" placeholder="Search team, employee, or date…" value={search} onChange={e=>setSearch(e.target.value)} style={{flex:'2 1 220px'}}/>
    </div>
    <div className="muted" style={{fontSize:'.82rem',marginBottom:'.6rem'}}>{count} schedule rows · {visible.length} date sections</div>
    {busy&&<p className="muted">Loading schedules…</p>}
    {error&&<p className="error">{error}</p>}
    {!busy&&!error&&!files.length&&<section className="card"><p className="muted">No shared schedule spreadsheets found. Ask the owner to share a Google Sheet from Files & resources.</p></section>}
    {!busy&&!error&&files.length>0&&!visible.length&&<p className="muted">No schedule rows match these filters.</p>}
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,300px),1fr))',gap:'.65rem',alignItems:'start'}}>
      {visible.map((section,si)=><section className="card" key={section.title+'-'+si} style={{padding:'.75rem',margin:0,minWidth:0}}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'.5rem',marginBottom:'.5rem'}}><h2 style={{fontSize:'.98rem',margin:0}}>{section.title}</h2><span className="badge">{section.rows.length}</span></div>
        <div style={{display:'grid',gap:'.35rem'}}>
          {section.rows.map((r,ri)=>{
            const cells=r.map((v,i)=>({v,i})).filter(x=>filled(x.v))
            const nameCell=cells.find(x=>/[a-z]/i.test(x.v)&&!NUM.test(x.v))
            return <div key={ri} style={{border:'1px solid var(--border)',borderRadius:'9px',padding:'.45rem .55rem',background:'var(--background,transparent)',fontSize:'.78rem',minWidth:0}}>
              <div style={{fontWeight:750,overflowWrap:'anywhere',marginBottom:'.18rem'}}>{nameCell?.v || cells[0]?.v || 'Schedule row'}</div>
              <div style={{display:'flex',gap:'.25rem',flexWrap:'wrap'}}>{cells.filter(x=>x!==nameCell).map(x=><span key={x.i} style={{border:'1px solid var(--border)',borderRadius:'5px',padding:'.1rem .3rem',maxWidth:'100%',overflowWrap:'anywhere'}}><span className="muted">{section.headers[x.i] ? section.headers[x.i]+': ' : ''}</span>{x.v}</span>)}</div>
            </div>
          })}
        </div>
      </section>)}
    </div>
  </>
}
