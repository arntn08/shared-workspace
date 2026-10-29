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
  const [selectedRow,setSelectedRow] = useState<{section:string;headers:string[];cells:string[]}|null>(null)
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
    <style>{`
      .hr-schedule-page{--rose:#c76b91;--rose-deep:#9f4e70;--rose-soft:#f9e9f0;--rose-line:#efd3df;color:var(--text)}
      .hr-schedule-page .schedule-hero{position:relative;overflow:hidden;padding:1.25rem 1.35rem;border:1px solid var(--rose-line);border-radius:22px;background:linear-gradient(115deg,#fff8fb 0%,#fff 54%,#f5efff 100%);box-shadow:0 12px 35px rgba(158,91,123,.08);margin-bottom:1rem}
      .hr-schedule-page .schedule-kicker{font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;font-weight:800;color:var(--rose-deep);margin-bottom:.35rem}
      .hr-schedule-page .schedule-hero h1{font-size:clamp(1.45rem,2.2vw,2rem);letter-spacing:-.04em;margin:0 0 .35rem;color:#573d4a}
      .hr-schedule-page .schedule-hero p{color:#8a7180;max-width:640px}
      .hr-schedule-page .schedule-hero:after{content:'✿';position:absolute;right:1.4rem;top:.5rem;font-size:4.4rem;color:#e8b9ce;opacity:.5;transform:rotate(12deg);pointer-events:none}
      .hr-schedule-page .schedule-tools{padding:.75rem;background:rgba(255,250,252,.78);border:1px solid var(--rose-line);border-radius:16px;box-shadow:0 5px 20px rgba(158,91,123,.045)}
      .hr-schedule-page .schedule-tools input,.hr-schedule-page .schedule-tools select{border-color:#e8c9d7;border-radius:11px;background:#fff;color:#5e4954;min-height:40px}
      .hr-schedule-page .schedule-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,290px),1fr));gap:.85rem;align-items:start}
      .hr-schedule-page .schedule-column{padding:.85rem!important;margin:0!important;min-width:0;border:1px solid #efd5e0!important;border-radius:18px!important;background:linear-gradient(160deg,#fffdfd,#fff8fb)!important;box-shadow:0 7px 24px rgba(139,83,110,.07);}
      .hr-schedule-page .schedule-column h2{font-size:.9rem!important;letter-spacing:.015em;color:#674657;line-height:1.4}
      .hr-schedule-page .schedule-count{display:inline-flex;align-items:center;justify-content:center;min-width:29px;height:29px;padding:0 .45rem;border-radius:10px;background:#f7e4ed;color:#9e4e72;font-weight:800;font-size:.78rem;border:1px solid #edcada}
      .hr-schedule-page button.schedule-person{width:100%;text-align:left;cursor:pointer;font:inherit;display:block}.hr-schedule-page .schedule-person{border:1px solid #efcddd!important;border-radius:13px!important;padding:.6rem!important;background:linear-gradient(125deg,#fff0f6 0%,#fff8fb 55%,#f4efff 100%)!important;color:#5a4751;font-size:.76rem;box-shadow:0 2px 7px rgba(120,75,96,.035);transition:transform .18s ease,box-shadow .18s ease}
      .hr-schedule-page .schedule-person:focus-visible{outline:3px solid #b95f86;outline-offset:2px}.hr-schedule-page .schedule-person:hover{transform:translateY(-1px);box-shadow:0 6px 14px rgba(120,75,96,.08)}
      .hr-schedule-page .schedule-person-name{display:flex;align-items:center;gap:.4rem;color:#70435a;font-size:.79rem;margin-bottom:.45rem}
      .hr-schedule-page .schedule-chip{display:inline-flex;align-items:center;max-width:100%;border:1px solid #f0d9e4!important;border-radius:7px!important;padding:.2rem .42rem!important;background:linear-gradient(115deg,#fff8fb,#f8efff);color:#705c66;line-height:1.45;overflow-wrap:anywhere}
      .hr-schedule-page .schedule-chip-label{color:#ad7891;font-weight:650}
      .hr-schedule-page .schedule-meta{color:#9b7c8b;font-size:.78rem;margin:.2rem 0 .7rem}
      .hr-schedule-page .schedule-refresh{border-radius:11px;background:#b95f86;color:white;border:1px solid #b95f86;padding:.58rem .9rem;box-shadow:0 5px 12px rgba(185,95,134,.17)}
      .hr-schedule-page .schedule-refresh:hover{background:#a64e75}
      .hr-schedule-modal-backdrop{position:fixed;inset:0;z-index:1000;background:rgba(20,15,25,.58);backdrop-filter:blur(7px);display:grid;place-items:center;padding:1rem}.hr-schedule-modal{width:min(100%,560px);max-height:min(85vh,760px);overflow:auto;background:linear-gradient(145deg,#fffafd,#fff 60%,#f5efff);border:1px solid #e9c9d9;border-radius:22px;padding:1.1rem;box-shadow:0 24px 80px rgba(0,0,0,.25);color:#513d49}.hr-schedule-modal-head{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;border-bottom:1px solid #efd8e3;padding-bottom:.8rem;margin-bottom:.75rem}.hr-schedule-modal h2{margin:0;color:#674257;font-size:1.2rem}.hr-schedule-modal-close{width:38px;height:38px;border:1px solid #e8cad8;border-radius:12px;background:#fff0f6;color:#8e4969;font-size:1.5rem;cursor:pointer}.hr-schedule-modal-lines{display:grid;gap:.55rem}.hr-schedule-modal-line{display:flex;flex-direction:column;gap:.25rem;padding:.7rem .75rem;border:1px solid #efd9e4;border-radius:12px;background:linear-gradient(110deg,#fff,#fff5fa 65%,#f5f0ff);overflow-wrap:anywhere}.hr-schedule-modal-line span{font-size:.72rem;font-weight:750;letter-spacing:.04em;text-transform:uppercase;color:#a06e86}.hr-schedule-modal-line strong{font-size:.95rem;color:#493746;white-space:pre-wrap;overflow-wrap:anywhere}[data-theme="dark"] .hr-schedule-modal{background:linear-gradient(145deg,#29212c,#211d2b);border-color:#65445c;color:#f5eaf0}[data-theme="dark"] .hr-schedule-modal h2{color:#f4d5e4}[data-theme="dark"] .hr-schedule-modal-line{background:linear-gradient(110deg,#342838,#2a2639);border-color:#594052}[data-theme="dark"] .hr-schedule-modal-line strong{color:#f8edf3}[data-theme="dark"] .hr-schedule-modal-line span{color:#d4a9c0}[data-theme="dark"] .hr-schedule-modal-close{background:#392a3b;color:#f4d5e4;border-color:#65445c}
      [data-theme="dark"] .hr-schedule-page .schedule-hero{background:linear-gradient(120deg,#2a2028,#272334);border-color:#594052}
      [data-theme="dark"] .hr-schedule-page .schedule-hero h1{color:#f8eaf1}
      [data-theme="dark"] .hr-schedule-page .schedule-hero p{color:#d0b7c6}
      [data-theme="dark"] .hr-schedule-page .schedule-tools{background:#211c24;border-color:#594052}
      [data-theme="dark"] .hr-schedule-page .schedule-tools input,[data-theme="dark"] .hr-schedule-page .schedule-tools select{background:#2b2430;color:#f5eaf0;border-color:#594052}
      [data-theme="dark"] .hr-schedule-page .schedule-column{background:linear-gradient(160deg,#29232c,#241f28)!important;border-color:#594052!important}
      [data-theme="dark"] .hr-schedule-page .schedule-column h2,[data-theme="dark"] .hr-schedule-page .schedule-person-name{color:#f0cddd}
      [data-theme="dark"] .hr-schedule-page .schedule-person{background:linear-gradient(125deg,#392b3b,#302638 60%,#25273a)!important;border-color:#65445c!important;color:#f2e5ec}
      [data-theme="dark"] .hr-schedule-page .schedule-chip{background:linear-gradient(115deg,#3b2c3b,#30283d);color:#f1dce6;border-color:#624357!important}
      @media(max-width:640px){.hr-schedule-page .schedule-hero{padding:1rem}.hr-schedule-page .schedule-hero:after{font-size:3rem;right:.7rem}.hr-schedule-page .schedule-grid{grid-template-columns:1fr}}
      .hr-schedule-page .schedule-hero{background:linear-gradient(125deg,#05070d,#0b1730 52%,#123b78)!important;border-color:#234b85!important}
.hr-schedule-page .schedule-kicker{color:#9fc5ff!important}
.hr-schedule-page .schedule-hero h1{color:#f3f7ff!important}
.hr-schedule-page .schedule-hero p{color:#c2d4f3!important}
.hr-schedule-page .schedule-hero:after{color:#75aaff!important;opacity:.24!important}
.hr-schedule-page .schedule-tools{background:linear-gradient(125deg,#080d18,#101f38 65%,#142c50)!important;border-color:#294775!important}
.hr-schedule-page .schedule-tools input,.hr-schedule-page .schedule-tools select{background:#0d1728!important;color:#eaf2ff!important;border-color:#355783!important}
.hr-schedule-page .schedule-column{background:linear-gradient(145deg,#090d16,#101a2b 58%,#142541)!important;border-color:#294775!important}
.hr-schedule-page .schedule-column h2{color:#dbe9ff!important}
.hr-schedule-page .schedule-count{background:linear-gradient(135deg,#14294a,#1e4b88)!important;color:#eaf3ff!important;border-color:#3b67a5!important}
.hr-schedule-page .schedule-person{background:linear-gradient(125deg,#080b12,#101d32 58%,#173968)!important;border-color:#2d5285!important;color:#e7efff!important}
.hr-schedule-page .schedule-person-name{color:#c8ddff!important}
.hr-schedule-page .schedule-chip{background:linear-gradient(115deg,#101a2b,#182d4d)!important;color:#d9e8ff!important;border-color:#2d4e7a!important}
.hr-schedule-page .schedule-chip-label{color:#8db9ff!important}
.hr-schedule-page .schedule-meta{color:#9db3d4!important}
.hr-schedule-page .schedule-refresh{background:linear-gradient(120deg,#101827,#174b91)!important;border-color:#3869a8!important;color:#fff!important}
.hr-schedule-modal{background:linear-gradient(145deg,#080c14,#101c30 60%,#17345d)!important;border-color:#31558a!important;color:#eaf2ff!important}
.hr-schedule-modal h2{color:#e4efff!important}
.hr-schedule-modal-close{background:linear-gradient(135deg,#101a2b,#1b3d6e)!important;border-color:#355783!important;color:#fff!important}
.hr-schedule-modal-line{background:linear-gradient(110deg,#0d1625,#142844)!important;border-color:#2d4e7a!important}
.hr-schedule-modal-line span{color:#9fc5ff!important}
.hr-schedule-modal-line strong{color:#f0f6ff!important}
    `}
</style>
    <div className="hr-schedule-page">
    <div className="schedule-hero"><div className="schedule-kicker">♡ People • Planning • Progress</div><div className="page-head"><div><h1>Team schedules</h1><p className="muted" style={{margin:0}}>All shared team schedules in a compact calendar-style overview.</p></div><button className="schedule-refresh" onClick={()=>fileId&&void load(fileId,tab)}>↻ Refresh</button></div></div>
    <div className="row schedule-tools" style={{gap:'.55rem',marginBottom:'.75rem',flexWrap:'wrap'}}>
      {files.length>1&&<select aria-label="Schedule spreadsheet" value={fileId} onChange={e=>setFileId(e.target.value)} style={{flex:'1 1 220px'}}>{files.map(f=><option key={f.id} value={f.id}>{f.title}</option>)}</select>}
      {tabs.length>1&&<select aria-label="Schedule tab" value={tab} onChange={e=>void load(fileId,e.target.value)} style={{flex:'1 1 160px'}}>{tabs.map(t=><option key={t} value={t}>{t}</option>)}</select>}
      <select aria-label="Filter schedule date" value={dateFilter} onChange={e=>setDateFilter(e.target.value)} style={{flex:'1 1 150px'}}><option value="all">All dates</option>{dates.map(d=><option key={d} value={d}>{d}</option>)}</select>
      <input aria-label="Search schedules" placeholder="Search team, employee, or date…" value={search} onChange={e=>setSearch(e.target.value)} style={{flex:'2 1 220px'}}/>
    </div>
    <div className="schedule-meta">♡ {count} schedule rows <span style={{padding:"0 .35rem"}}>·</span> {visible.length} date / team sections</div>
    {busy&&<p className="muted">Loading schedules…</p>}
    {error&&<p className="error">{error}</p>}
    {!busy&&!error&&!files.length&&<section className="card"><p className="muted">No shared schedule spreadsheets found. Ask the owner to share a Google Sheet from Files & resources.</p></section>}
    {!busy&&!error&&files.length>0&&!visible.length&&<p className="muted">No schedule rows match these filters.</p>}
    <div className="schedule-grid">
      {visible.map((section,si)=><section className="card schedule-column" key={section.title+'-'+si}>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'.5rem',marginBottom:'.5rem'}}><h2 style={{fontSize:'.98rem',margin:0}}>{section.title}</h2><span className="schedule-count">{section.rows.length}</span></div>
        <div style={{display:'grid',gap:'.35rem'}}>
          {section.rows.map((r,ri)=>{
            const cells=r.map((v,i)=>({v,i})).filter(x=>filled(x.v))
            const nameCell=cells.find(x=>/[a-z]/i.test(x.v)&&!NUM.test(x.v))
            return <button type="button" key={ri} className="schedule-person" onClick={()=>setSelectedRow({section:section.title,headers:section.headers,cells:r})} aria-label={`View schedule details for ${nameCell?.v || cells[0]?.v || 'schedule row'}`}>
              <div className="schedule-person-name"><span>♡</span><strong style={{overflowWrap:"anywhere"}}>{nameCell?.v || cells[0]?.v || 'Schedule row'}</strong></div>
              <div style={{display:'flex',gap:'.25rem',flexWrap:'wrap'}}>{cells.filter(x=>x!==nameCell).map(x=><span key={x.i} className="schedule-chip"><span className="schedule-chip-label">{section.headers[x.i] ? section.headers[x.i]+': ' : ''}</span>{x.v}</span>)}</div>
            </button>
          })}
        </div>
      </section>)}
    </div>
    </div>

    {selectedRow&&<div className="hr-schedule-modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setSelectedRow(null)}}><section className="hr-schedule-modal" role="dialog" aria-modal="true" aria-labelledby="hr-schedule-modal-title" onKeyDown={e=>{if(e.key==='Escape')setSelectedRow(null)}}><div className="hr-schedule-modal-head"><div><div className="schedule-kicker">Schedule details</div><h2 id="hr-schedule-modal-title">{selectedRow.section}</h2></div><button type="button" className="hr-schedule-modal-close" onClick={()=>setSelectedRow(null)} aria-label="Close schedule details">×</button></div><div className="hr-schedule-modal-lines">{selectedRow.cells.map((value,i)=>value.trim()?<div className="hr-schedule-modal-line" key={i}><span>{selectedRow.headers[i]||'Detail '+(i+1)}</span><strong>{value}</strong></div>:null)}</div></section></div>}
  </>
}
