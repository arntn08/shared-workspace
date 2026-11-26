import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import type { FileRow } from '../types'

type Sheet = { tabs: string[]; tab: string; rows: string[][] }
type ScheduleRow = { cells: string[]; sheetRow: number }
type Section = { title: string; headers: string[]; rows: ScheduleRow[] }
type RosterPerson = { name: string; team: string }
type EmployeeSlot = { section: string; sheetRow: number; col: number; role: string; value: string; name: string }
type CellUpdate = { row: number; col: number; old: string; value: string; section: string; role: string; team: string }
type MoveDraft = { movedEmployee: string; movedFromCell: string | null; movedFromTeam: string | null; replacedEmployee: string | null; targetCell: string; targetTeam: string; section: string; role: string; updates: CellUpdate[] }
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

function normalizeEmployeeName(v: string) { return v.replace(/^\*+/, '').replace(/\s+/g, ' ').trim().toLocaleUpperCase() }
function displayEmployeeName(v: string) { return v.replace(/^\*+/, '').trim() }
function employeeHeader(v: string) { return /driver|drver|technician|tech\b|employee|personnel|crew|staff|worker/i.test(v) }
function colLetter(index: number) { let n=index+1,s=''; while(n>0){const m=(n-1)%26;s=String.fromCharCode(65+m)+s;n=Math.floor((n-1)/26)} return s }
function a1Cell(row: number,col: number) { return `${colLetter(col)}${row+1}` }
function employeeSlots(section: Section,row: ScheduleRow,rosterNames: Set<string>): EmployeeSlot[] {
  const columns=section.headers.map((h,i)=>({h,i})).filter(x=>employeeHeader(x.h))
  if(columns.length) return columns.map(({h,i})=>({section:section.title,sheetRow:row.sheetRow,col:i,role:h||'Employee',value:row.cells[i]||'',name:displayEmployeeName(row.cells[i]||'')}))
  return row.cells.map((value,col)=>({value,col})).filter(x=>filled(x.value)&&rosterNames.has(normalizeEmployeeName(x.value))).map(x=>({section:section.title,sheetRow:row.sheetRow,col:x.col,role:'Employee',value:x.value,name:displayEmployeeName(x.value)}))
}
function parseAbsences(rows: string[][]) {
  const header=rows.findIndex(r=>(r||[]).some(v=>/REST DAY/i.test(String(v||'')))&&(r||[]).some(v=>/SUSPENDED/i.test(String(v||''))))
  const found=new Map<string,{employee_name:string;status:string;source_cell:string}>()
  if(header<0) return [...found.values()]
  for(let i=header+1;i<rows.length;i++){
    const r=(rows[i]||[]).map(clean),name=r[4]||'',status=r[5]||''
    if(name&&/absent|vacation|leave|rest\s*day/i.test(status)) found.set(normalizeEmployeeName(name),{employee_name:displayEmployeeName(name),status:status.toUpperCase(),source_cell:`E${i+1}`})
    if(r[8]&&!/SUSPENDED/i.test(r[8])) found.set(normalizeEmployeeName(r[8]),{employee_name:displayEmployeeName(r[8]),status:'SUSPENDED',source_cell:`I${i+1}`})
    if(r[9]&&!/RESIGN/i.test(r[9])) found.set(normalizeEmployeeName(r[9]),{employee_name:displayEmployeeName(r[9]),status:'RESIGNED',source_cell:`J${i+1}`})
  }
  return [...found.values()]
}

function parseSections(rows: string[][]): Section[] {
  const sections: Section[] = []
  let title = 'Schedule', headers: string[] = [], body: ScheduleRow[] = [], seenTitle = false, expectHeaders = false
  const flush = () => { if (body.length) sections.push({ title, headers, rows: body }); body = [] }
  rows.forEach((raw, sheetRow) => {
    const cells = (Array.isArray(raw) ? raw : []).map(clean)
    if (!cells.some(filled)) return
    if (isHeading(cells)) {
      flush()
      const label = cells.find(filled) || ''
      if (!seenTitle) { seenTitle = true; title = label; return }
      title = label; headers = []; expectHeaders = true; return
    }
    if (expectHeaders) { headers = cells; expectHeaders = false; return }
    if (!headers.length) headers = cells.map((_, i) => 'Column ' + (i + 1))
    body.push({ cells, sheetRow })
  })
  flush()
  return sections
}
export default function HrTeamSchedule() {
  const { profile } = useAuth()
  const canEdit = profile?.active === true && (profile.role === 'owner' || profile.role === 'editor')
  const isHr = profile?.role === 'hr' || profile?.role === 'ar_encoder'
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
  const [roster,setRoster] = useState<RosterPerson[]>([])
  const [pendingMoves,setPendingMoves] = useState<MoveDraft[]>([])
  const [poolSearch,setPoolSearch] = useState('')
  const [saving,setSaving] = useState(false)
  const [dragName,setDragName] = useState('')
  const [notice,setNotice] = useState('')
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
    const nextRows = (data.rows ?? []) as string[][]
    const nextTab = data.tab ?? t ?? ''
    setTabs(data.tabs ?? []); setTab(nextTab); setRows(nextRows); setPendingMoves([])
    if (canEdit) {
      const { data: people } = await supabase.from('roster').select('name,team').order('team').order('name')
      const list = (people ?? []) as RosterPerson[]; setRoster(list)
      const names = new Set(list.map(p => normalizeEmployeeName(p.name)))
      const snapshot = parseSections(nextRows).flatMap(s => s.rows.flatMap(r => employeeSlots(s,r,names).map(slot => ({file_id:id,tab:nextTab,date_key:nextTab,cell_a1:a1Cell(slot.sheetRow,slot.col),section:s.title,role:slot.role,employee_name:slot.value.trim()||null,employee_team:s.title,updated_by:profile?.id,updated_at:new Date().toISOString()}))))
      if (snapshot.length) await supabase.from('schedule_daily_assignments').upsert(snapshot,{onConflict:'file_id,tab,cell_a1'})
      const dayAbsences = parseAbsences(nextRows)
      await supabase.from('schedule_absences').delete().eq('file_id',id).eq('tab',nextTab)
      if (dayAbsences.length) await supabase.from('schedule_absences').insert(dayAbsences.map(a=>({file_id:id,tab:nextTab,employee_name:a.employee_name,status:a.status,source_cell:a.source_cell,recorded_by:profile?.id})))
    }
    setBusy(false)
  }
  useEffect(()=>{ if(fileId) void load(fileId) },[fileId])
  const sections = useMemo(()=>parseSections(rows),[rows])
  const rosterNames = useMemo(()=>new Set(roster.map(p=>normalizeEmployeeName(p.name))),[roster])
  const allSlots = useMemo(()=>sections.flatMap(s=>s.rows.flatMap(r=>employeeSlots(s,r,rosterNames))),[sections,rosterNames])
  const assigned = useMemo(()=>{const m=new Map<string,EmployeeSlot[]>();allSlots.filter(s=>filled(s.value)).forEach(s=>{const k=normalizeEmployeeName(s.value);m.set(k,[...(m.get(k)||[]),s])});return m},[allSlots])
  const absences = useMemo(()=>parseAbsences(rows),[rows])
  const absentNames = useMemo(()=>new Set(absences.map(a=>normalizeEmployeeName(a.employee_name))),[absences])
  const pool = roster.filter(p=>!absentNames.has(normalizeEmployeeName(p.name))&&(!poolSearch.trim()||p.name.toLowerCase().includes(poolSearch.toLowerCase())||p.team.toLowerCase().includes(poolSearch.toLowerCase())))
  const dates = useMemo(()=>sections.map(s=>s.title).filter((v,i,a)=>a.indexOf(v)===i),[sections])
  const visible = sections.filter(s=>(dateFilter==='all'||s.title===dateFilter)&&(!search.trim()||s.title.toLowerCase().includes(search.toLowerCase())||s.rows.some(r=>r.cells.some(c=>c.toLowerCase().includes(search.toLowerCase())))))
  const count = visible.reduce((sum,s)=>sum+s.rows.length,0)

  function updateLocalCells(updates: CellUpdate[]) {
    setRows(current=>{const next=current.map(r=>[...r]);updates.forEach(u=>{while(next[u.row].length<=u.col)next[u.row].push('');next[u.row][u.col]=u.value});return next})
  }
  function handleDrop(target: EmployeeSlot, name: string) {
    if(!canEdit||!name)return
    const key=normalizeEmployeeName(name)
    if(absentNames.has(key)){setError('This employee is marked absent, on leave, suspended, or resigned.');return}
    const matches=assigned.get(key)||[]
    if(matches.length>1){setError(`${displayEmployeeName(name)} appears in multiple schedule slots. Resolve the duplicate first.`);return}
    const source=matches[0]||null
    if(source&&source.sheetRow===target.sheetRow&&source.col===target.col)return
    const sourceTeam=source?.section||roster.find(p=>normalizeEmployeeName(p.name)===key)?.team||null
    if(sourceTeam&&sourceTeam.toLowerCase()!==target.section.toLowerCase()){
      if(!window.confirm(`Move ${displayEmployeeName(name)} from ${sourceTeam} to ${target.section}?\\n\\nThe original slot will become VACANT. You can fill that vacancy with another employee.`))return
    }
    const updates:CellUpdate[]=[]
    if(source)updates.push({row:source.sheetRow,col:source.col,old:source.value,value:'',section:source.section,role:source.role,team:source.section})
    updates.push({row:target.sheetRow,col:target.col,old:target.value,value:displayEmployeeName(name),section:target.section,role:target.role,team:target.section})
    const move:MoveDraft={movedEmployee:displayEmployeeName(name),movedFromCell:source?a1Cell(source.sheetRow,source.col):null,movedFromTeam:sourceTeam,replacedEmployee:target.value.trim()?displayEmployeeName(target.value):null,targetCell:a1Cell(target.sheetRow,target.col),targetTeam:target.section,section:target.section,role:target.role,updates}
    updateLocalCells(updates);setPendingMoves(current=>[...current,move]);setError('');setNotice(`${displayEmployeeName(name)} staged for ${target.section}. Save changes to sync both systems.`)
  }
  function undoLastMove(){
    const last=pendingMoves[pendingMoves.length-1];if(!last)return
    updateLocalCells(last.updates.map(u=>({...u,old:u.value,value:u.old})))
    setPendingMoves(current=>current.slice(0,-1));setNotice('Last pending move undone.')
  }
  async function saveScheduleChanges(){
    if(!canEdit||!pendingMoves.length||saving)return
    setSaving(true);setError('');setNotice('')
    const remaining=[...pendingMoves]
    while(remaining.length){
      const m=remaining[0]
      const {data,error:invokeError}=await supabase.functions.invoke('move-schedule',{body:{fileId,tab,dateKey:tab,movedEmployee:m.movedEmployee,movedFromCell:m.movedFromCell,movedFromTeam:m.movedFromTeam,replacedEmployee:m.replacedEmployee,targetCell:m.targetCell,targetTeam:m.targetTeam,section:m.section,role:m.role,updates:m.updates.map(u=>({row:u.row,col:u.col,old:u.old,value:u.value,section:u.section,role:u.role,team:u.team}))}})
      if(invokeError||!data?.ok){setError(data?.error||invokeError?.message||'Could not synchronize the schedule.');setPendingMoves(remaining);setSaving(false);return}
      remaining.shift();setPendingMoves([...remaining])
    }
    setSaving(false);setNotice('Changes saved to Supabase and Google Sheets.');await load(fileId,tab)
  }

  return <>
    <style>{`
      .hr-schedule-page.hr-schedule-hr{--rose:#c76b91;--rose-deep:#9f4e70;--rose-soft:#f9e9f0;--rose-line:#efd3df;color:var(--text)}
      .hr-schedule-page.hr-schedule-hr .schedule-hero{position:relative;overflow:hidden;padding:1.25rem 1.35rem;border:1px solid var(--rose-line);border-radius:22px;background:linear-gradient(115deg,#fff8fb 0%,#fff 54%,#f5efff 100%);box-shadow:0 12px 35px rgba(158,91,123,.08);margin-bottom:1rem}
      .hr-schedule-page.hr-schedule-hr .schedule-kicker{font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;font-weight:800;color:var(--rose-deep);margin-bottom:.35rem}
      .hr-schedule-page.hr-schedule-hr .schedule-hero h1{font-size:clamp(1.45rem,2.2vw,2rem);letter-spacing:-.04em;margin:0 0 .35rem;color:#573d4a}
      .hr-schedule-page.hr-schedule-hr .schedule-hero p{color:#8a7180;max-width:640px}
      .hr-schedule-page.hr-schedule-hr .schedule-hero:after{content:'✿';position:absolute;right:1.4rem;top:.5rem;font-size:4.4rem;color:#e8b9ce;opacity:.5;transform:rotate(12deg);pointer-events:none}
      .hr-schedule-page.hr-schedule-hr .schedule-tools{padding:.75rem;background:rgba(255,250,252,.78);border:1px solid var(--rose-line);border-radius:16px;box-shadow:0 5px 20px rgba(158,91,123,.045)}
      .hr-schedule-page.hr-schedule-hr .schedule-tools input,.hr-schedule-page.hr-schedule-hr .schedule-tools select{border-color:#e8c9d7;border-radius:11px;background:#fff;color:#5e4954;min-height:40px}
      .hr-schedule-page.hr-schedule-hr .schedule-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,290px),1fr));gap:.85rem;align-items:start}
      .hr-schedule-page.hr-schedule-hr .schedule-column{padding:.85rem!important;margin:0!important;min-width:0;border:1px solid #efd5e0!important;border-radius:18px!important;background:linear-gradient(160deg,#fffdfd,#fff8fb)!important;box-shadow:0 7px 24px rgba(139,83,110,.07);}
      .hr-schedule-page.hr-schedule-hr .schedule-column h2{font-size:.9rem!important;letter-spacing:.015em;color:#674657;line-height:1.4}
      .hr-schedule-page.hr-schedule-hr .schedule-count{display:inline-flex;align-items:center;justify-content:center;min-width:29px;height:29px;padding:0 .45rem;border-radius:10px;background:#f7e4ed;color:#9e4e72;font-weight:800;font-size:.78rem;border:1px solid #edcada}
      .hr-schedule-page.hr-schedule-hr button.schedule-person{width:100%;text-align:left;cursor:pointer;font:inherit;display:block}.hr-schedule-page.hr-schedule-hr .schedule-person{border:1px solid #efcddd!important;border-radius:13px!important;padding:.6rem!important;background:linear-gradient(125deg,#fff0f6 0%,#fff8fb 55%,#f4efff 100%)!important;color:#5a4751;font-size:.76rem;box-shadow:0 2px 7px rgba(120,75,96,.035);transition:transform .18s ease,box-shadow .18s ease}
      .hr-schedule-page.hr-schedule-hr .schedule-person:focus-visible{outline:3px solid #b95f86;outline-offset:2px}.hr-schedule-page.hr-schedule-hr .schedule-person:hover{transform:translateY(-1px);box-shadow:0 6px 14px rgba(120,75,96,.08)}
      .hr-schedule-page.hr-schedule-hr .schedule-person-name{display:flex;align-items:center;gap:.4rem;color:#70435a;font-size:.79rem;margin-bottom:.45rem}
      .hr-schedule-page.hr-schedule-hr .schedule-chip{display:inline-flex;align-items:center;max-width:100%;border:1px solid #f0d9e4!important;border-radius:7px!important;padding:.2rem .42rem!important;background:linear-gradient(115deg,#fff8fb,#f8efff);color:#705c66;line-height:1.45;overflow-wrap:anywhere}
      .hr-schedule-page.hr-schedule-hr .schedule-chip-label{color:#ad7891;font-weight:650}
      .hr-schedule-page.hr-schedule-hr .schedule-meta{color:#9b7c8b;font-size:.78rem;margin:.2rem 0 .7rem}
      .hr-schedule-page.hr-schedule-hr .schedule-refresh{border-radius:11px;background:#b95f86;color:white;border:1px solid #b95f86;padding:.58rem .9rem;box-shadow:0 5px 12px rgba(185,95,134,.17)}
      .hr-schedule-page.hr-schedule-hr .schedule-refresh:hover{background:#a64e75}
      .hr-schedule-modal-backdrop{position:fixed;inset:0;z-index:1000;background:rgba(20,15,25,.58);backdrop-filter:blur(7px);display:grid;place-items:center;padding:1rem}.hr-schedule-modal{width:min(100%,560px);max-height:min(85vh,760px);overflow:auto;background:linear-gradient(145deg,#fffafd,#fff 60%,#f5efff);border:1px solid #e9c9d9;border-radius:22px;padding:1.1rem;box-shadow:0 24px 80px rgba(0,0,0,.25);color:#513d49}.hr-schedule-modal-head{display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;border-bottom:1px solid #efd8e3;padding-bottom:.8rem;margin-bottom:.75rem}.hr-schedule-modal h2{margin:0;color:#674257;font-size:1.2rem}.hr-schedule-modal-close{width:38px;height:38px;border:1px solid #e8cad8;border-radius:12px;background:#fff0f6;color:#8e4969;font-size:1.5rem;cursor:pointer}.hr-schedule-modal-lines{display:grid;gap:.55rem}.hr-schedule-modal-line{display:flex;flex-direction:column;gap:.25rem;padding:.7rem .75rem;border:1px solid #efd9e4;border-radius:12px;background:linear-gradient(110deg,#fff,#fff5fa 65%,#f5f0ff);overflow-wrap:anywhere}.hr-schedule-modal-line span{font-size:.72rem;font-weight:750;letter-spacing:.04em;text-transform:uppercase;color:#a06e86}.hr-schedule-modal-line strong{font-size:.95rem;color:#493746;white-space:pre-wrap;overflow-wrap:anywhere}[data-theme="dark"] .hr-schedule-modal{background:linear-gradient(145deg,#29212c,#211d2b);border-color:#65445c;color:#f5eaf0}[data-theme="dark"] .hr-schedule-modal h2{color:#f4d5e4}[data-theme="dark"] .hr-schedule-modal-line{background:linear-gradient(110deg,#342838,#2a2639);border-color:#594052}[data-theme="dark"] .hr-schedule-modal-line strong{color:#f8edf3}[data-theme="dark"] .hr-schedule-modal-line span{color:#d4a9c0}[data-theme="dark"] .hr-schedule-modal-close{background:#392a3b;color:#f4d5e4;border-color:#65445c}
      [data-theme="dark"] .hr-schedule-page.hr-schedule-hr .schedule-hero{background:linear-gradient(120deg,#2a2028,#272334);border-color:#594052}
      [data-theme="dark"] .hr-schedule-page.hr-schedule-hr .schedule-hero h1{color:#f8eaf1}
      [data-theme="dark"] .hr-schedule-page.hr-schedule-hr .schedule-hero p{color:#d0b7c6}
      [data-theme="dark"] .hr-schedule-page.hr-schedule-hr .schedule-tools{background:#211c24;border-color:#594052}
      [data-theme="dark"] .hr-schedule-page.hr-schedule-hr .schedule-tools input,[data-theme="dark"] .hr-schedule-page.hr-schedule-hr .schedule-tools select{background:#2b2430;color:#f5eaf0;border-color:#594052}
      [data-theme="dark"] .hr-schedule-page.hr-schedule-hr .schedule-column{background:linear-gradient(160deg,#29232c,#241f28)!important;border-color:#594052!important}
      [data-theme="dark"] .hr-schedule-page.hr-schedule-hr .schedule-column h2,[data-theme="dark"] .hr-schedule-page.hr-schedule-hr .schedule-person-name{color:#f0cddd}
      [data-theme="dark"] .hr-schedule-page.hr-schedule-hr .schedule-person{background:linear-gradient(125deg,#392b3b,#302638 60%,#25273a)!important;border-color:#65445c!important;color:#f2e5ec}
      [data-theme="dark"] .hr-schedule-page.hr-schedule-hr .schedule-chip{background:linear-gradient(115deg,#3b2c3b,#30283d);color:#f1dce6;border-color:#624357!important}

      /* Keep Owner, Editor, HR and AR Encoder schedule cards on the same compact grid */
      .hr-schedule-page .schedule-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,290px),1fr));gap:1rem!important;align-items:start}
      .hr-schedule-page .schedule-column{width:100%;min-width:0;max-width:100%;align-self:start}

      /* Owner and Editor schedule palette */
      .hr-schedule-page:not(.hr-schedule-hr){color:var(--text)}
      .hr-schedule-page:not(.hr-schedule-hr) .schedule-hero{background:linear-gradient(115deg,#f5f9ff 0%,#fff 52%,#eaf1fb 100%);border-color:#cbdcf2;box-shadow:0 12px 35px rgba(54,91,145,.09)}
      .hr-schedule-page:not(.hr-schedule-hr) .schedule-kicker{color:#315f9b}
      .hr-schedule-page:not(.hr-schedule-hr) .schedule-hero h1{color:#263d5c}
      .hr-schedule-page:not(.hr-schedule-hr) .schedule-hero p{color:#71839d}
      .hr-schedule-page:not(.hr-schedule-hr) .schedule-hero:after{content:'✦';color:#9bb9e4}
      .hr-schedule-page:not(.hr-schedule-hr) .schedule-tools{background:rgba(247,250,255,.88);border-color:#cbdcf2}
      .hr-schedule-page:not(.hr-schedule-hr) .schedule-tools input,.hr-schedule-page:not(.hr-schedule-hr) .schedule-tools select{border-color:#cbdcf2;color:#334a68}
      .hr-schedule-page:not(.hr-schedule-hr) .schedule-column{border-color:#cbdcf2!important;background:linear-gradient(160deg,#fff,#f3f7fd)!important;box-shadow:0 7px 24px rgba(55,91,145,.08)}
      .hr-schedule-page:not(.hr-schedule-hr) .schedule-column h2{color:#34547d}
      .hr-schedule-page:not(.hr-schedule-hr) .schedule-count{background:#e8f0fb;color:#315f9b;border-color:#cbdcf2}
      .hr-schedule-page:not(.hr-schedule-hr) .schedule-person{border-color:#cbdcf2!important;background:linear-gradient(125deg,#edf4ff,#f8faff 60%,#e9eff9)!important;color:#334a68}
      .hr-schedule-page:not(.hr-schedule-hr) .schedule-person-name{color:#315f9b}
      .hr-schedule-page:not(.hr-schedule-hr) .schedule-chip{border-color:#d5e2f3!important;background:linear-gradient(115deg,#f7faff,#eaf1fb);color:#536a89}
      .hr-schedule-page:not(.hr-schedule-hr) .schedule-chip-label{color:#6d8db8}
      .hr-schedule-page:not(.hr-schedule-hr) .schedule-refresh{background:#315f9b;border-color:#315f9b}
      .hr-schedule-page:not(.hr-schedule-hr) .schedule-refresh:hover{background:#274e80}
      [data-theme="dark"] .hr-schedule-page:not(.hr-schedule-hr) .schedule-hero{background:linear-gradient(120deg,#17263a,#1e293b);border-color:#344b69}
      [data-theme="dark"] .hr-schedule-page:not(.hr-schedule-hr) .schedule-hero h1{color:#e7f0ff}
      [data-theme="dark"] .hr-schedule-page:not(.hr-schedule-hr) .schedule-hero p{color:#a9bad1}
      [data-theme="dark"] .hr-schedule-page:not(.hr-schedule-hr) .schedule-tools{background:#172235;border-color:#344b69}
      [data-theme="dark"] .hr-schedule-page:not(.hr-schedule-hr) .schedule-tools input,[data-theme="dark"] .hr-schedule-page:not(.hr-schedule-hr) .schedule-tools select{background:#202f45;color:#e5efff;border-color:#405979}
      [data-theme="dark"] .hr-schedule-page:not(.hr-schedule-hr) .schedule-column{background:linear-gradient(160deg,#1c2b40,#172437)!important;border-color:#344b69!important}
      [data-theme="dark"] .hr-schedule-page:not(.hr-schedule-hr) .schedule-column h2,[data-theme="dark"] .hr-schedule-page:not(.hr-schedule-hr) .schedule-person-name{color:#c5dcff}
      [data-theme="dark"] .hr-schedule-page:not(.hr-schedule-hr) .schedule-person{background:linear-gradient(125deg,#243a56,#1d3049 60%,#19283d)!important;border-color:#405979!important;color:#e2edff}
      [data-theme="dark"] .hr-schedule-page:not(.hr-schedule-hr) .schedule-chip{background:linear-gradient(115deg,#263c58,#1e3049);color:#d9e7fa;border-color:#405979!important}
      .hr-schedule-modal-blue{background:rgba(8,18,34,.68)}
      .hr-schedule-modal-blue .hr-schedule-modal{background:linear-gradient(145deg,#f7faff,#fff 60%,#eaf1fb);border-color:#cbdcf2;color:#263d5c}
      .hr-schedule-modal-blue .hr-schedule-modal h2{color:#315f9b}
      .hr-schedule-modal-blue .hr-schedule-modal-line{background:linear-gradient(110deg,#fff,#f2f7ff 65%,#eaf1fb);border-color:#cbdcf2}
      .hr-schedule-modal-blue .hr-schedule-modal-line strong{color:#263d5c}
      .hr-schedule-modal-blue .hr-schedule-modal-line span{color:#6d8db8}
      .hr-schedule-modal-blue .hr-schedule-modal-close{background:#edf4ff;color:#315f9b;border-color:#cbdcf2}
      [data-theme="dark"] .hr-schedule-modal-blue .hr-schedule-modal{background:linear-gradient(145deg,#1c2b40,#172437);border-color:#344b69;color:#e5efff}
      [data-theme="dark"] .hr-schedule-modal-blue .hr-schedule-modal h2{color:#c5dcff}
      [data-theme="dark"] .hr-schedule-modal-blue .hr-schedule-modal-line{background:linear-gradient(110deg,#243a56,#1d3049);border-color:#405979}
      [data-theme="dark"] .hr-schedule-modal-blue .hr-schedule-modal-line strong{color:#e2edff}
      [data-theme="dark"] .hr-schedule-modal-blue .hr-schedule-modal-line span{color:#a9c5e8}
      [data-theme="dark"] .hr-schedule-modal-blue .hr-schedule-modal-close{background:#243a56;color:#c5dcff;border-color:#405979}

      @media(max-width:640px){.hr-schedule-page.hr-schedule-hr .schedule-hero{padding:1rem}.hr-schedule-page.hr-schedule-hr .schedule-hero:after{font-size:3rem;right:.7rem}.hr-schedule-page.hr-schedule-hr .schedule-grid{grid-template-columns:1fr}}


      /* Prevent long spreadsheet values from colliding inside schedule cards */
      .hr-schedule-page .schedule-grid{grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));align-items:start}
      .hr-schedule-page .schedule-column{min-width:0;overflow:hidden}
      .hr-schedule-page .schedule-people-list{min-width:0}
      .hr-schedule-page button.schedule-person{box-sizing:border-box!important;display:grid!important;grid-template-columns:minmax(0,1fr);gap:.65rem!important;min-width:0!important;max-width:100%!important;overflow:hidden!important;white-space:normal!important;overflow-wrap:anywhere!important}
      .hr-schedule-page .schedule-person-name{display:flex!important;align-items:center!important;gap:.55rem!important;width:100%;min-width:0;margin:0!important}
      .hr-schedule-page .schedule-person-name strong{display:block;flex:1 1 auto;min-width:0;max-width:100%;white-space:normal!important;overflow-wrap:anywhere!important;word-break:break-word;line-height:1.35}
      .hr-schedule-page .schedule-person-open{flex:0 0 auto;margin-left:auto}
      .hr-schedule-page .schedule-person-fields{display:grid!important;grid-template-columns:repeat(auto-fit,minmax(min(100%,145px),1fr));gap:.35rem!important;min-width:0;width:100%}
      .hr-schedule-page .schedule-chip{display:block!important;box-sizing:border-box;min-width:0;max-width:100%;white-space:normal!important;overflow-wrap:anywhere!important;word-break:break-word;line-height:1.4!important}
      .hr-schedule-page .schedule-chip-label{overflow-wrap:anywhere;word-break:break-word}
      /* Refined schedule layout */
      .hr-schedule-page .schedule-hero{display:flex;align-items:center;justify-content:space-between;gap:1.5rem;padding:1.65rem 1.8rem!important;border-radius:24px!important;margin-bottom:1rem!important;min-height:150px}
      .hr-schedule-page .schedule-hero-copy{position:relative;z-index:1}
      .hr-schedule-page .schedule-kicker{display:flex;align-items:center;gap:.5rem;font-size:.67rem!important;letter-spacing:.14em!important;margin-bottom:.65rem!important}
      .hr-schedule-page .schedule-kicker-mark{font-size:1rem}
      .hr-schedule-page .schedule-kicker-divider{opacity:.45}
      .hr-schedule-page .schedule-hero h1{font-size:clamp(1.65rem,3vw,2.25rem)!important;line-height:1.08;letter-spacing:-.055em!important;margin-bottom:.5rem!important}
      .hr-schedule-page .schedule-hero p{font-size:.91rem;line-height:1.55;margin:0!important;max-width:540px}
      .hr-schedule-page .schedule-hero:after{font-size:6rem!important;right:8.5rem!important;top:1.1rem!important;opacity:.22!important}
      .hr-schedule-page .schedule-refresh{position:relative;z-index:1;display:inline-flex;align-items:center;justify-content:center;gap:.55rem;white-space:nowrap;font-weight:750;font-size:.8rem;padding:.75rem 1rem!important;border-radius:13px!important;transition:transform .18s ease,box-shadow .18s ease}
      .hr-schedule-page .schedule-refresh:hover{transform:translateY(-1px);box-shadow:0 8px 18px rgba(50,90,145,.18)}
      .hr-schedule-page .schedule-refresh:disabled{opacity:.72;cursor:wait}
      .schedule-refresh-icon{font-size:1.1rem;line-height:1}
      .schedule-refresh-icon.is-spinning{animation:schedule-spin .8s linear infinite}
      @keyframes schedule-spin{to{transform:rotate(360deg)}}
      .schedule-overview-strip{display:flex;align-items:center;gap:1.1rem;padding:.85rem 1.05rem;margin-bottom:.8rem;border:1px solid var(--line,rgba(130,145,170,.18));border-radius:17px;background:var(--card,rgba(255,255,255,.72));box-shadow:0 5px 18px rgba(30,50,80,.035)}
      .schedule-stat{display:flex;align-items:center;gap:.7rem;min-width:132px}
      .schedule-stat-icon{width:37px;height:37px;display:grid;place-items:center;border-radius:12px;font-size:1.1rem;background:rgba(120,150,190,.12);color:var(--accent,#5478a8)}
      .schedule-stat div{display:grid;gap:.05rem}
      .schedule-stat strong{font-size:1.12rem;line-height:1.1;color:var(--text);font-variant-numeric:tabular-nums}
      .schedule-stat div span{font-size:.69rem;color:var(--muted);font-weight:600}
      .schedule-stat-divider{width:1px;height:32px;background:var(--line,rgba(130,145,170,.2))}
      .schedule-stat-note{margin-left:auto;font-size:.72rem;color:var(--muted)}
      .schedule-stat-note span{padding:0 .3rem}
      .hr-schedule-page .schedule-tools{display:flex;align-items:center;gap:.75rem;padding:.75rem!important;margin-bottom:1rem!important;border-radius:17px!important}
      .schedule-search-wrap{position:relative;display:flex;align-items:center;flex:1 1 260px;min-width:180px}
      .schedule-search-icon{position:absolute;left:.85rem;font-size:1.2rem;color:var(--muted);pointer-events:none}
      .schedule-search-wrap input{width:100%;min-width:0;padding:.68rem 2.2rem .68rem 2.45rem;border:1px solid var(--line);border-radius:12px;outline:none;font:inherit;font-size:.79rem;min-height:42px}
      .schedule-search-wrap input:focus{border-color:var(--accent,#7395c2);box-shadow:0 0 0 3px rgba(100,145,205,.12)}
      .schedule-clear-search{position:absolute;right:.5rem;border:0;background:transparent;color:var(--muted);font-size:1.2rem;cursor:pointer}
      .schedule-filter-group{display:flex;align-items:center;gap:.55rem;flex-wrap:wrap}
      .schedule-filter{display:grid;gap:.2rem;min-width:120px}
      .schedule-filter>span{font-size:.61rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding-left:.15rem}
      .schedule-filter select{min-width:120px;max-width:210px;padding:.58rem 2rem .58rem .7rem;border:1px solid var(--line);border-radius:11px;font:inherit;font-size:.75rem;min-height:42px}
      .hr-schedule-page .schedule-grid{gap:1rem!important}
      .hr-schedule-page .schedule-column{padding:1rem!important;border-radius:19px!important}
      .schedule-column-head{display:flex;align-items:center;justify-content:space-between;gap:.75rem;padding:0 0 .8rem;margin-bottom:.8rem;border-bottom:1px solid var(--line,rgba(130,145,170,.18))}
      .schedule-section-label{display:block;font-size:.58rem;font-weight:800;letter-spacing:.13em;color:var(--muted);margin-bottom:.25rem}
      .schedule-column-head h2{font-size:.96rem!important;font-weight:800;letter-spacing:-.02em;margin:0!important}
      .schedule-count{display:flex!important;flex-direction:column;align-items:center;justify-content:center;min-width:42px!important;height:42px!important;border-radius:13px!important;font-size:.95rem!important;line-height:1.05}
      .schedule-count small{font-size:.52rem;font-weight:700;opacity:.75;margin-top:.18rem}
      .schedule-people-list{display:grid;gap:.55rem}
      .hr-schedule-page button.schedule-person{padding:.75rem!important;border-radius:14px!important;text-align:left}
      .schedule-person-name{display:flex;align-items:center;gap:.6rem!important;min-width:0;margin-bottom:.55rem!important}
      .schedule-person-avatar{display:grid;place-items:center;flex:0 0 31px;width:31px;height:31px;border-radius:10px;font-size:.72rem;font-weight:850;background:rgba(205,130,165,.14);color:var(--accent,#9e4e72)}
      .schedule-person-name strong{min-width:0;flex:1;font-size:.8rem;line-height:1.35}
      .schedule-person-open{font-size:.62rem;font-weight:700;opacity:.55;white-space:nowrap}
      .hr-schedule-page .schedule-chip{font-size:.65rem;padding:.25rem .45rem!important;border-radius:8px!important}
      .hr-schedule-page:not(.hr-schedule-hr) .schedule-person-avatar{background:#dce9fa;color:#315f9b}
      [data-theme="dark"] .schedule-overview-strip{background:rgba(20,32,49,.82);border-color:rgba(130,160,200,.2)}
      [data-theme="dark"] .schedule-search-wrap input,[data-theme="dark"] .schedule-filter select{background:#172437;color:#e5efff;border-color:#344b69}
      [data-theme="dark"] .schedule-stat strong{color:#e5efff}
      [data-theme="dark"] .hr-schedule-page.hr-schedule-hr .schedule-overview-strip{background:rgba(39,31,43,.88);border-color:#594052}
      [data-theme="dark"] .hr-schedule-page.hr-schedule-hr .schedule-search-wrap input,[data-theme="dark"] .hr-schedule-page.hr-schedule-hr .schedule-filter select{background:#2b2430;color:#f5eaf0;border-color:#594052}
      [data-theme="dark"] .hr-schedule-page.hr-schedule-hr .schedule-stat strong{color:#f5eaf0}
      @media(max-width:760px){
        .hr-schedule-page .schedule-hero{align-items:flex-start;padding:1.2rem!important;min-height:unset}
        .hr-schedule-page .schedule-hero:after{right:.8rem!important;top:.3rem!important;font-size:4rem!important}
        .hr-schedule-page .schedule-refresh{font-size:0;padding:.65rem!important;width:42px;height:42px;flex:0 0 42px}
        .hr-schedule-page .schedule-refresh-icon{font-size:1.25rem}
        .schedule-overview-strip{gap:.7rem;padding:.7rem}
        .schedule-stat{min-width:0;gap:.45rem}
        .schedule-stat-icon{width:31px;height:31px}
        .schedule-stat strong{font-size:1rem}
        .schedule-stat div span{font-size:.61rem}
        .schedule-stat-note{display:none}
        .hr-schedule-page .schedule-tools{align-items:stretch;flex-direction:column}
        .schedule-search-wrap{flex:1 1 auto;width:100%}
        .schedule-filter-group{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));width:100%}
        .schedule-filter select{width:100%;max-width:none}
      }
      @media(max-width:420px){.schedule-overview-strip{gap:.5rem}.schedule-stat-divider{height:26px}.schedule-stat-icon{display:none}.schedule-stat{flex:1}}


      .schedule-employee-slots{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:.35rem;margin-top:.45rem}
      .schedule-employee-slot{min-width:0;border:1px solid var(--line);border-radius:9px;padding:.4rem .48rem;background:var(--card);font-size:.68rem;color:var(--text);overflow-wrap:anywhere}
      .schedule-employee-slot[draggable="true"]{cursor:grab;border-color:var(--accent,#7395c2)}
      .schedule-employee-slot.is-empty{border-style:dashed;color:var(--muted);min-height:34px}
      .schedule-employee-slot span{display:block;font-size:.53rem;text-transform:uppercase;letter-spacing:.06em;font-weight:800;color:var(--muted);margin-bottom:.15rem}
      .schedule-editor-panel{display:grid;grid-template-columns:minmax(0,1fr) minmax(240px,310px);gap:.8rem;margin-top:1rem}
      .schedule-pool{padding:.85rem;border:1px solid var(--line);border-radius:15px;background:var(--card);min-width:0}
      .schedule-pool h3{font-size:.88rem;margin:0 0 .25rem;color:var(--text)}
      .schedule-pool p{font-size:.68rem;color:var(--muted);margin:.2rem 0 .55rem}
      .schedule-pool input{width:100%;padding:.55rem .7rem;border:1px solid var(--line);border-radius:9px;background:var(--bg);color:var(--text);margin-bottom:.5rem}
      .schedule-pool-list{display:flex;flex-wrap:wrap;gap:.35rem;max-height:230px;overflow:auto}
      .schedule-pool-list button{border:1px solid var(--line);border-radius:9px;background:var(--bg);color:var(--text);padding:.4rem .5rem;text-align:left;cursor:grab;font-size:.66rem}
      .schedule-pool-list small{display:block;color:var(--muted);font-size:.56rem}
      .schedule-review>span{border-radius:8px;padding:.1rem .35rem;background:var(--accent-soft);color:var(--accent)}
      .schedule-review-item{padding:.45rem;border:1px solid var(--line);border-radius:8px;margin:.35rem 0;font-size:.66rem}
      .schedule-review-item small{display:block;color:var(--muted);margin-top:.15rem}
      .schedule-review-actions{display:flex;gap:.4rem;margin-top:.65rem}
      .schedule-review-actions button{border:1px solid var(--line);border-radius:9px;padding:.5rem .65rem;background:var(--card);color:var(--text);font-size:.68rem;font-weight:750;cursor:pointer}
      .schedule-review-actions button:last-child{background:var(--accent,#315f9b);border-color:var(--accent,#315f9b);color:white}
      .schedule-review-actions button:disabled{opacity:.45;cursor:not-allowed}
      .schedule-sync-notice{font-size:.72rem;color:var(--accent);margin:.6rem 0}
      @media(max-width:760px){.schedule-editor-panel{grid-template-columns:1fr}}
    `}
</style>
    <div className={`hr-schedule-page${isHr ? ' hr-schedule-hr' : ''}`}>
    <div className="schedule-hero"><div className="schedule-hero-copy"><div className="schedule-kicker"><span className="schedule-kicker-mark">✦</span> PEOPLE OPERATIONS <span className="schedule-kicker-divider">/</span> PLANNING</div><h1>Team schedules</h1><p>One clear view of shared team plans, dates, and assignments.</p></div><button className="schedule-refresh" onClick={()=>fileId&&void load(fileId,tab)} disabled={busy}><span className={busy ? 'schedule-refresh-icon is-spinning' : 'schedule-refresh-icon'}>↻</span>{busy ? 'Refreshing' : 'Refresh schedule'}</button></div>
    <div className="schedule-overview-strip"><div className="schedule-stat"><span className="schedule-stat-icon">▤</span><div><strong>{count}</strong><span>Schedule entries</span></div></div><div className="schedule-stat-divider"/><div className="schedule-stat"><span className="schedule-stat-icon">▦</span><div><strong>{visible.length}</strong><span>Visible sections</span></div></div><div className="schedule-stat-note">Shared team planning <span>•</span> Updated from workspace files</div></div>
    <div className="schedule-tools">
      <div className="schedule-search-wrap"><span className="schedule-search-icon">⌕</span><input aria-label="Search schedules" placeholder="Search people, teams, or dates…" value={search} onChange={e=>setSearch(e.target.value)}/>{search&&<button type="button" className="schedule-clear-search" onClick={()=>setSearch('')} aria-label="Clear search">×</button>}</div>
      <div className="schedule-filter-group">
        {files.length>1&&<label className="schedule-filter"><span>Spreadsheet</span><select aria-label="Schedule spreadsheet" value={fileId} onChange={e=>setFileId(e.target.value)}>{files.map(f=><option key={f.id} value={f.id}>{f.title}</option>)}</select></label>}
        {tabs.length>1&&<label className="schedule-filter"><span>Sheet tab</span><select aria-label="Schedule tab" value={tab} onChange={e=>void load(fileId,e.target.value)}>{tabs.map(t=><option key={t} value={t}>{t}</option>)}</select></label>}
        <label className="schedule-filter"><span>Date range</span><select aria-label="Filter schedule date" value={dateFilter} onChange={e=>setDateFilter(e.target.value)}><option value="all">All dates</option>{dates.map(d=><option key={d} value={d}>{d}</option>)}</select></label>
      </div>
    </div>
    {busy&&<p className="muted">Loading schedules…</p>}
    {error&&<p className="error">{error}</p>}
    {!busy&&!error&&!files.length&&<section className="card"><p className="muted">No shared schedule spreadsheets found. Ask the owner to share a Google Sheet from Files & resources.</p></section>}
    {!busy&&!error&&files.length>0&&!visible.length&&<p className="muted">No schedule rows match these filters.</p>}
    <div className="schedule-grid">
      {visible.map((section,si)=><section className="card schedule-column" key={section.title+'-'+si}>
        <div className="schedule-column-head"><div><span className="schedule-section-label">SCHEDULE GROUP</span><h2>{section.title}</h2></div><span className="schedule-count">{section.rows.length}<small>items</small></span></div>
        <div className="schedule-people-list">
          {section.rows.map((r,ri)=>{
            const slots=employeeSlots(section,r,rosterNames)
            const employeeCols=new Set(slots.map(s=>s.col))
            const cells=r.cells.map((v,i)=>({v,i})).filter(x=>filled(x.v)&&!employeeCols.has(x.i))
            return <article type="button" key={r.sheetRow+'-'+ri} className="schedule-person">
              <div className="schedule-person-name"><span className="schedule-person-avatar">{(cells[0]?.v || slots[0]?.name || 'S').trim().charAt(0).toUpperCase()}</span><strong>{cells.slice(0,2).map(x=>x.v).join(' · ') || `Schedule row ${r.sheetRow+1}`}</strong><button type="button" className="schedule-person-open" onClick={()=>setSelectedRow({section:section.title,headers:section.headers,cells:r.cells})}>Details ↗</button></div>
              <div className="schedule-person-fields">{cells.slice(2).map(x=><span key={x.i} className="schedule-chip"><span className="schedule-chip-label">{section.headers[x.i] ? section.headers[x.i]+': ' : ''}</span>{x.v}</span>)}</div>
              <div className="schedule-employee-slots">{slots.map(slot=><div key={slot.col} className={`schedule-employee-slot ${slot.name?'':'is-empty'}`} draggable={canEdit&&!!slot.name} onDragStart={e=>{setDragName(slot.value);e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',slot.value)}} onDragEnd={()=>setDragName('')} onDragOver={e=>{if(canEdit){e.preventDefault();e.dataTransfer.dropEffect='move'}}} onDrop={e=>{e.preventDefault();const name=e.dataTransfer.getData('text/plain')||dragName;if(name)handleDrop(slot,name)}}><span>{slot.role}</span>{slot.name||'Drop employee here'}</div>)}</div>
            </article>
          })}
        </div>
      </section>)}
    </div>

    {canEdit&&!busy&&<div className="schedule-editor-panel">
      <section className="schedule-pool"><h3>Employee pool</h3><p>All roster employees are available to drag, including employees assigned to other teams. Absent, leave, suspended, and resigned employees are excluded.</p><input placeholder="Search employees or teams…" value={poolSearch} onChange={e=>setPoolSearch(e.target.value)}/><div className="schedule-pool-list">{pool.map(person=>{const current=assigned.get(normalizeEmployeeName(person.name))?.[0];return <button type="button" key={person.name+'-'+person.team} draggable onDragStart={e=>{setDragName(person.name);e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',person.name)}} onDragEnd={()=>setDragName('')}><strong>{person.name}</strong><small>{current?`Currently: ${current.section}`:person.team||'Unassigned'}</small></button>})}</div></section>
      <section className="schedule-pool schedule-review"><h3>Review changes <span>{pendingMoves.length}</span></h3><p>Drag changes are staged first. Save to update Supabase and Google Sheets.</p>{pendingMoves.map((m,i)=><div className="schedule-review-item" key={i}><strong>{m.movedEmployee}</strong><small>{m.movedFromTeam?`${m.movedFromTeam} → ${m.targetTeam}`:`Added to ${m.targetTeam}`}{m.replacedEmployee?` · replaces ${m.replacedEmployee}`:''}</small></div>)}<div className="schedule-review-actions"><button type="button" disabled={!pendingMoves.length||saving} onClick={undoLastMove}>Undo last</button><button type="button" disabled={!pendingMoves.length||saving} onClick={()=>void saveScheduleChanges()}>{saving?'Saving…':'Save changes'}</button></div></section>
    </div>}
    {notice&&<p className="schedule-sync-notice">{notice}</p>}
    </div>

    {selectedRow&&<div className={`hr-schedule-modal-backdrop${isHr ? ' hr-schedule-modal-hr' : ' hr-schedule-modal-blue'}`} onMouseDown={e=>{if(e.target===e.currentTarget)setSelectedRow(null)}}><section className="hr-schedule-modal" role="dialog" aria-modal="true" aria-labelledby="hr-schedule-modal-title" onKeyDown={e=>{if(e.key==='Escape')setSelectedRow(null)}}><div className="hr-schedule-modal-head"><div><div className="schedule-kicker">Schedule details</div><h2 id="hr-schedule-modal-title">{selectedRow.section}</h2></div><button type="button" className="hr-schedule-modal-close" onClick={()=>setSelectedRow(null)} aria-label="Close schedule details">×</button></div><div className="hr-schedule-modal-lines">{selectedRow.cells.map((value,i)=>value.trim()?<div className="hr-schedule-modal-line" key={i}><span>{selectedRow.headers[i]||'Detail '+(i+1)}</span><strong>{value}</strong></div>:null)}</div></section></div>}
  </>
}
