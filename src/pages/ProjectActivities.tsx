import { useEffect, useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

type Leader = { user_id: string; team_leader_name: string; district: string; team_code: string }
type Proposal = { id: string; team_leader_id: string; activity_type: string; proposed_date: string | null; end_date: string | null; barangay: string | null; streets: string | null; location: string | null; details: string; remarks: string | null; status: string; coordinator_note: string | null; created_at: string }
type Booth = { id: string; team_leader_id: string; booth_location: string; barangay: string | null; deployment_start: string | null; deployment_end: string | null; remarks: string | null; status: string; coordinator_note: string | null }
type CalendarAssignment = { id: string; team_leader_id: string; scheduled_date: string; assignment_details: string; source_sheet: string }
type BoothDirectory = { id:string; team_leader:string; booth_location:string; barangay:string; deployment_date:string; remarks:string }
type AreaDirectory = { id:string; area_district:string; district:string; team_leader_reference:string; street_name:string }
type Schedule = { id: string; team_leader_id: string; activity_type: string; scheduled_date: string; end_date: string | null; barangay: string | null; streets: string | null; location: string | null; details: string; remarks: string | null }

export default function ProjectActivities({ coordinator = false }: { coordinator?: boolean }) {
  const { profile } = useAuth()
  const [leader, setLeader] = useState<Leader | null>(null)
  const [leaders, setLeaders] = useState<Leader[]>([])
  const [proposals, setProposals] = useState<Proposal[]>([])
  const [booths, setBooths] = useState<Booth[]>([])
  const [schedule, setSchedule] = useState<Schedule[]>([])
  const [calendarAssignments, setCalendarAssignments] = useState<CalendarAssignment[]>([])
  const [boothDirectory,setBoothDirectory]=useState<BoothDirectory[]>([])
  const [areaDirectory,setAreaDirectory]=useState<AreaDirectory[]>([])
  const [areaSearch,setAreaSearch]=useState('')
  const [areaDistrict,setAreaDistrict]=useState('All')
  const [calendarMonth, setCalendarMonth] = useState('2026-10')
  const [tab, setTab] = useState<'overview'|'proposals'|'booths'|'calendar'|'areas'|'import'>('overview')
  const [kind, setKind] = useState('Saturation')
  const [date, setDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [barangay, setBarangay] = useState('')
  const [streets, setStreets] = useState('')
  const [location, setLocation] = useState('')
  const [details, setDetails] = useState('')
  const [remarks, setRemarks] = useState('')
  const [boothLocation, setBoothLocation] = useState('')
  const [boothBarangay, setBoothBarangay] = useState('')
  const [boothStart, setBoothStart] = useState('')
  const [boothEnd, setBoothEnd] = useState('')
  const [boothRemarks, setBoothRemarks] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [importing,setImporting]=useState(false)
  const [importSummary,setImportSummary]=useState('')

  async function importWorkbook(file: File) {
    if (!coordinator) return
    setImporting(true); setMessage(''); setImportSummary('')
    try {
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
      const leaderByName = new Map(leaders.map(l => [l.team_leader_name.trim().toLowerCase(), l.user_id]))
      const saturationRows: any[] = []; const boothRows: any[] = []; const areaRows: any[] = []
      const clean = (v: unknown) => String(v ?? '').trim()
      const dateKey = (v: unknown) => { if (v instanceof Date && !Number.isNaN(v.getTime())) return [v.getUTCFullYear(),String(v.getUTCMonth()+1).padStart(2,'0'),String(v.getUTCDate()).padStart(2,'0')].join('-'); if (typeof v === 'number') { const d=XLSX.SSF.parse_date_code(v); return d ? [d.y,String(d.m).padStart(2,'0'),String(d.d).padStart(2,'0')].join('-') : '' }; return '' }
      workbook.SheetNames.forEach(name => {
        const ws=workbook.Sheets[name]; const rows=XLSX.utils.sheet_to_json<any[]>(ws,{header:1,defval:null,raw:true})
        if (/^SATURATION/i.test(name)) {
          for(let r=1;r<rows.length;r++){ const row=rows[r]; const leaderName=clean(row[0]).replace(/\s+-\s+D\d+$/i,'').toLowerCase(); const leaderId=leaderByName.get(leaderName); if(!leaderId) continue; for(let col=1;col<(rows[0]||[]).length;col++){ const assignment=clean(row[col]); const scheduled_date=dateKey(rows[0][col]); if(assignment&&scheduled_date)saturationRows.push({team_leader_id:leaderId,scheduled_date,assignment_details:assignment,source_sheet:name}) } }
        } else if (/^Booth$/i.test(name)) {
          for(let r=1;r<rows.length;r++){ const row=rows[r]||[]; if(row.some((v:any)=>clean(v))) boothRows.push({team_leader:clean(row[0]),booth_location:clean(row[1]),barangay:clean(row[2]),deployment_date:clean(row[3]),remarks:clean(row[4])}) }
        } else if (/^Area$/i.test(name)) {
          (rows[0]||[]).forEach((h:any,col:number)=>{ const header=clean(h); if(!header)return; const match=header.match(/^(.*?)\s*\/\s*(D\d+)\s*$/i); const area=match?.[1]?.trim()||header; const district=match?.[2]?.toUpperCase()||''; const tl=clean(rows[2]?.[col]); for(let r=3;r<rows.length;r++){ const street=clean(rows[r]?.[col]); if(street)areaRows.push({area_district:area,district,team_leader_reference:tl,street_name:street}) } })
        }
      })
      if(!saturationRows.length&&!boothRows.length&&!areaRows.length) throw new Error('No recognized workbook records found. Expected SATURATION, Booth and Area worksheets.')
      if(saturationRows.length){const {error}=await supabase.from('sales_calendar_assignments').upsert(saturationRows,{onConflict:'team_leader_id,scheduled_date'});if(error)throw error}
      if(boothRows.length){const {error:e}=await supabase.from('sales_booth_directory').delete().not('id','is',null);if(e)throw e;const {error}=await supabase.from('sales_booth_directory').insert(boothRows);if(error)throw error}
      if(areaRows.length){const {error:e}=await supabase.from('sales_area_directory').delete().not('id','is',null);if(e)throw e;const {error}=await supabase.from('sales_area_directory').insert(areaRows);if(error)throw error}
      setImportSummary('Imported '+saturationRows.length+' saturation assignments, '+boothRows.length+' booth rows, and '+areaRows.length+' area/street entries.');setMessage('Workbook import completed.');await load()
    } catch(err){setMessage(err instanceof Error?err.message:'Workbook import failed.')} finally{setImporting(false)}
  }
  async function load() {
    if (!profile) return
    if (coordinator) {
      const [l,p,b,s,cal,bd,ad] = await Promise.all([
        supabase.from('sales_team_leaders').select('*').eq('active',true).order('district'),
        supabase.from('sales_activity_proposals').select('*').order('created_at',{ascending:false}),
        supabase.from('sales_booth_deployments').select('*').order('created_at',{ascending:false}),
        supabase.from('sales_activity_schedule').select('*').order('scheduled_date'),
        supabase.from('sales_calendar_assignments').select('*').order('scheduled_date'),
        supabase.from('sales_booth_directory').select('*').order('team_leader'),
        supabase.from('sales_area_directory').select('*').order('area_district').order('street_name')
      ])
      if (l.error || p.error || b.error || s.error || cal.error || bd.error || ad.error) { setMessage([l.error,p.error,b.error,s.error,cal.error,bd.error,ad.error].find(Boolean)?.message || 'Unable to load module. Apply the SQL migration first.'); return }
      setLeaders(l.data || []); setProposals(p.data || []); setBooths(b.data || []); setSchedule(s.data || []); setCalendarAssignments(cal.data || []); setBoothDirectory(bd.data||[]); setAreaDirectory(ad.data||[])
    } else {
      const [l,p,b,s,cal] = await Promise.all([
        supabase.from('sales_team_leaders').select('*').eq('user_id',profile.id).eq('active',true).maybeSingle(),
        supabase.from('sales_activity_proposals').select('*').order('created_at',{ascending:false}),
        supabase.from('sales_booth_deployments').select('*').order('created_at',{ascending:false}),
        supabase.from('sales_activity_schedule').select('*').order('scheduled_date'),
        supabase.from('sales_calendar_assignments').select('*').order('scheduled_date')
      ])
      if (l.error || p.error || b.error || s.error || cal.error) { setMessage([l.error,p.error,b.error,s.error,cal.error].find(Boolean)?.message || 'Unable to load module.'); return }
      setLeader(l.data); setProposals(p.data || []); setBooths(b.data || []); setSchedule(s.data || []); setCalendarAssignments(cal.data || [])
    }
  }
  useEffect(() => { void load() }, [profile?.id, coordinator])

  async function submitProposal(e: React.FormEvent) {
    e.preventDefault(); if (!profile) return
    setBusy(true); setMessage('')
    const { error } = await supabase.from('sales_activity_proposals').insert({ team_leader_id: profile.id, activity_type: kind, proposed_date: date || null, end_date: endDate || null, barangay: barangay || null, streets: streets || null, location: location || null, details, remarks: remarks || null })
    setBusy(false); setMessage(error?.message || 'Activity proposal submitted.'); if (!error) { setDate('');setEndDate('');setBarangay('');setStreets('');setLocation('');setDetails('');setRemarks('');void load() }
  }
  async function submitBooth(e: React.FormEvent) {
    e.preventDefault(); if (!profile) return
    setBusy(true); setMessage('')
    const { error } = await supabase.from('sales_booth_deployments').insert({ team_leader_id: profile.id, booth_location: boothLocation, barangay: boothBarangay || null, deployment_start: boothStart || null, deployment_end: boothEnd || null, remarks: boothRemarks || null })
    setBusy(false); setMessage(error?.message || 'Booth proposal submitted.'); if (!error) { setBoothLocation('');setBoothBarangay('');setBoothStart('');setBoothEnd('');setBoothRemarks('');void load() }
  }
  async function reviewProposal(p: Proposal, status: string) {
    const note = window.prompt('Coordinator note (optional):', p.coordinator_note || '') ?? p.coordinator_note
    const { error } = await supabase.from('sales_activity_proposals').update({ status, coordinator_note: note, reviewed_by: profile?.id, reviewed_at: new Date().toISOString() }).eq('id',p.id)
    if (error) setMessage(error.message)
    else if (status === 'approved') {
      const { error: publishError } = await supabase.from('sales_activity_schedule').insert({ source_proposal_id:p.id, team_leader_id:p.team_leader_id, activity_type:p.activity_type, scheduled_date:p.proposed_date, end_date:p.end_date, barangay:p.barangay, streets:p.streets, location:p.location, details:p.details, remarks:p.remarks, created_by:profile?.id })
      if (publishError) setMessage('Proposal approved, but schedule publishing failed: '+publishError.message)
    }
    void load()
  }
  async function reviewBooth(b: Booth, status: string) {
    const note = window.prompt('Coordinator note (optional):', b.coordinator_note || '') ?? b.coordinator_note
    const { error } = await supabase.from('sales_booth_deployments').update({ status, coordinator_note:note, reviewed_by:profile?.id, reviewed_at:new Date().toISOString() }).eq('id',b.id)
    if (error) setMessage(error.message)
    else setMessage('Booth proposal updated.')
    void load()
  }
  const pending = proposals.filter(p=>p.status==='pending').length + booths.filter(b=>b.status==='pending').length
  const title = coordinator ? 'Project Coordinator' : 'Team Leader Portal'
  const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
  const todayAssignments = calendarAssignments.filter(a => a.scheduled_date === todayKey)
  const monthAssignments = calendarAssignments.filter(a => a.scheduled_date.startsWith(calendarMonth))
  const monthLabel = new Date(calendarMonth + '-01T00:00:00').toLocaleDateString('en-PH',{month:'long',year:'numeric'})
  return <div className="project-activities-page">
    <style>{`
      .project-activities-page{display:grid;gap:1rem;color:var(--text)}
      .pa-hero{padding:1.5rem;border-radius:22px;background:linear-gradient(120deg,rgba(32,145,96,.13),rgba(90,170,130,.05));border:1px solid var(--border)}
      .pa-hero h1{margin:.2rem 0;font-size:clamp(1.5rem,3vw,2.1rem);letter-spacing:-.04em}
      .pa-hero p{margin:.35rem 0 0;color:var(--muted)}
      .pa-tabs{display:flex;gap:.5rem;flex-wrap:wrap}
      .pa-tabs button,.pa-btn{border:1px solid var(--border);border-radius:11px;padding:.65rem .9rem;background:var(--surface);color:var(--text);font:inherit;cursor:pointer}
      .pa-tabs button.active,.pa-btn.primary{background:#16865b;color:white;border-color:#16865b}
      .pa-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:.75rem}
      .pa-card{background:var(--surface);border:1px solid var(--border);border-radius:16px;padding:1rem}
      .pa-card strong{font-size:1.45rem;display:block}
      .pa-card span{color:var(--muted);font-size:.85rem}
      .pa-list{display:grid;gap:.7rem}
      .pa-item{border:1px solid var(--border);border-radius:15px;background:var(--surface);padding:1rem;display:grid;gap:.5rem}
      .pa-item-head{display:flex;align-items:flex-start;justify-content:space-between;gap:.6rem;flex-wrap:wrap}
      .pa-status{font-size:.72rem;font-weight:750;text-transform:uppercase;letter-spacing:.05em;color:#986c19}
      .pa-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.8rem}
      .pa-form label{display:grid;gap:.35rem;font-size:.83rem;font-weight:650}
      .pa-form input,.pa-form select,.pa-form textarea{width:100%;min-width:0;box-sizing:border-box;border:1px solid var(--border);border-radius:10px;padding:.7rem;background:var(--background,transparent);color:var(--text);font:inherit}
      .pa-form textarea{min-height:90px;resize:vertical}
      .pa-full{grid-column:1/-1}
      .pa-actions{display:flex;gap:.5rem;flex-wrap:wrap}
      .pa-today-grid{display:grid;gap:.7rem}.pa-today-row{display:grid;grid-template-columns:minmax(130px,.7fr) minmax(0,2fr);gap:.8rem;padding:.9rem;border:1px solid var(--border);border-radius:13px;background:var(--surface)}.pa-today-row strong{color:var(--text)}.pa-today-row pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font:inherit;color:var(--muted);font-size:.88rem}.pa-month-head{display:flex;align-items:center;justify-content:space-between;gap:.7rem;flex-wrap:wrap}.pa-month-head input{padding:.55rem;border:1px solid var(--border);border-radius:10px;background:var(--surface);color:var(--text)}
      .pa-note{padding:.75rem 1rem;border-radius:12px;background:rgba(25,145,95,.09);border:1px solid rgba(25,145,95,.2)}
      @media(max-width:620px){.pa-form{grid-template-columns:1fr}.pa-full{grid-column:auto}}
    `}</style>
    <header className="pa-hero"><span style={{fontSize:'.7rem',fontWeight:800,letterSpacing:'.14em',color:'#16865b'}}>AHBA DEVELOPMENT · FIELD OPERATIONS</span><h1>{title}</h1><p>{coordinator ? 'Today’s field assignments, monthly saturation plans, team proposals, and booth deployments.' : (leader ? leader.team_leader_name+' · District '+leader.district : 'Your dedicated sales team workspace')}</p></header>
    {message && <div className="pa-note">{message}</div>}
    <nav className="pa-tabs">{(['overview','proposals','booths','boothDirectory','calendar','areas','import'] as const).map(t=><button key={t} className={tab===t?'active':''} onClick={()=>setTab(t)}>{t==='overview'?'Overview':t==='proposals'?'Activity proposals':t==='booths'?'Booth proposals':t==='boothDirectory'?'Booth directory':t==='calendar'?'Saturation calendar':t==='areas'?'Area directory':t==='import'?'Import workbook':'Area directory'}</button>)}</nav>
    {tab==='overview' && <><div className="pa-grid"><div className="pa-card"><strong>{proposals.length}</strong><span>Activity proposals</span></div><div className="pa-card"><strong>{booths.length}</strong><span>Booth proposals</span></div><div className="pa-card"><strong>{pending}</strong><span>Awaiting review</span></div><div className="pa-card"><strong>{schedule.length}</strong><span>Approved activities</span></div></div>
      {!coordinator && <div className="pa-grid"><section className="pa-card"><h3>Propose an activity</h3><form className="pa-form" onSubmit={submitProposal}><label>Activity type<select value={kind} onChange={e=>setKind(e.target.value)}>{['Saturation','Event','Other'].map(x=><option key={x}>{x}</option>)}</select></label><label>Proposed date<input type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>End date (optional)<input type="date" value={endDate} onChange={e=>setEndDate(e.target.value)}/></label><label>Barangay<input value={barangay} onChange={e=>setBarangay(e.target.value)}/></label><label className="pa-full">Streets / coverage<input value={streets} onChange={e=>setStreets(e.target.value)}/></label><label className="pa-full">Activity details<textarea value={details} onChange={e=>setDetails(e.target.value)} required/></label><label className="pa-full">Remarks<textarea value={remarks} onChange={e=>setRemarks(e.target.value)}/></label><div className="pa-full"><button className="pa-btn primary" disabled={busy}>{busy?'Submitting…':'Submit activity proposal'}</button></div></form></section>
      <section className="pa-card"><h3>Propose a booth deployment</h3><form className="pa-form" onSubmit={submitBooth}><label className="pa-full">Booth location<input value={boothLocation} onChange={e=>setBoothLocation(e.target.value)} required/></label><label>Barangay<input value={boothBarangay} onChange={e=>setBoothBarangay(e.target.value)}/></label><label>Start date<input type="date" value={boothStart} onChange={e=>setBoothStart(e.target.value)}/></label><label>End date<input type="date" value={boothEnd} onChange={e=>setBoothEnd(e.target.value)}/></label><label className="pa-full">Remarks<textarea value={boothRemarks} onChange={e=>setBoothRemarks(e.target.value)}/></label><div className="pa-full"><button className="pa-btn primary" disabled={busy}>{busy?'Submitting…':'Submit booth proposal'}</button></div></form></section></div>}
      {coordinator && <section className="pa-card"><div className="pa-item-head"><h3>Today's sales calendar</h3><span className="pa-status">{new Date(todayKey+'T00:00:00').toLocaleDateString('en-PH',{weekday:'long',month:'short',day:'numeric'})}</span></div>{todayAssignments.length ? <div className="pa-today-grid">{todayAssignments.map(a=><div className="pa-today-row" key={a.id}><strong>{leaders.find(l=>l.user_id===a.team_leader_id)?.team_leader_name || 'Team leader'}<small style={{display:'block',color:'var(--muted)'}}>{leaders.find(l=>l.user_id===a.team_leader_id)?.district || ''}</small></strong><pre>{a.assignment_details}</pre></div>)}</div> : <p>No spreadsheet assignments recorded for today.</p>}</section>}
      {coordinator && <section className="pa-card"><h3>Sales teams</h3><div className="pa-list">{leaders.map(l=><div key={l.user_id} className="pa-item"><div className="pa-item-head"><strong>{l.team_leader_name}</strong><span className="pa-status">{l.district} · {l.team_code}</span></div></div>)}</div></section>}
    </>}
    {tab==='proposals' && <div className="pa-list">{proposals.map(p=><article className="pa-item" key={p.id}><div className="pa-item-head"><strong>{coordinator ? leaders.find(l=>l.user_id===p.team_leader_id)?.team_leader_name||'Team leader' : 'Your team'} · {p.activity_type}</strong><span className="pa-status">{p.status.replace('_',' ')}</span></div><div>{p.details}</div><div style={{color:'var(--muted)',fontSize:'.85rem'}}>{p.proposed_date||'Date not set'} {p.end_date?'– '+p.end_date:''} · {p.barangay||'No barangay'} · {p.streets||'No street details'}</div>{p.coordinator_note&&<p>Coordinator: {p.coordinator_note}</p>}{coordinator&&p.status==='pending'&&<div className="pa-actions"><button className="pa-btn primary" onClick={()=>void reviewProposal(p,'approved')}>Approve & publish</button><button className="pa-btn" onClick={()=>void reviewProposal(p,'changes_requested')}>Request changes</button><button className="pa-btn" onClick={()=>void reviewProposal(p,'rejected')}>Reject</button></div>}</article>)}{!proposals.length&&<p>No proposals yet.</p>}</div>}
    {tab==='booths' && <div className="pa-list">{booths.map(b=><article className="pa-item" key={b.id}><div className="pa-item-head"><strong>{coordinator?leaders.find(l=>l.user_id===b.team_leader_id)?.team_leader_name||'Team leader':'Your team'} · {b.booth_location}</strong><span className="pa-status">{b.status}</span></div><div>{b.barangay||'Barangay not specified'} · {b.deployment_start||'Date TBD'} {b.deployment_end?'– '+b.deployment_end:''}</div>{b.remarks&&<p>{b.remarks}</p>}{b.coordinator_note&&<p>Coordinator: {b.coordinator_note}</p>}{coordinator&&b.status==='pending'&&<div className="pa-actions"><button className="pa-btn primary" onClick={()=>void reviewBooth(b,'approved')}>Approve</button><button className="pa-btn" onClick={()=>void reviewBooth(b,'changes_requested')}>Request changes</button><button className="pa-btn" onClick={()=>void reviewBooth(b,'rejected')}>Reject</button></div>}</article>)}{!booths.length&&<p>No booth proposals yet.</p>}</div>}
    {tab==='import' && coordinator && <section className="pa-card"><h3>Import sales workbook</h3><p>Upload the original Excel workbook. The app reads the SATURATION month sheets, Booth, and Area worksheets and imports each into its own section.</p><label>Excel workbook (.xlsx, .xls)<input type="file" accept=".xlsx,.xls" disabled={importing} onChange={e=>{const file=e.target.files?.[0];if(file)void importWorkbook(file);e.currentTarget.value=''}} /></label>{importing&&<p>Reading workbook and importing records…</p>}{importSummary&&<div className="pa-note">{importSummary}</div>}<p style={{color:'var(--muted)',fontSize:'.85rem'}}>Re-importing updates matching saturation dates and replaces booth and area directory records with the uploaded workbook.</p></section>}
    {tab==='boothDirectory' && coordinator && <section className="pa-card"><h3>Existing booth locations · from workbook</h3><div className="pa-list">{boothDirectory.map(b=><article className="pa-item" key={b.id}><div className="pa-item-head"><strong>{b.team_leader}</strong><span className="pa-status">{b.remarks||'Listed'}</span></div><div>{b.booth_location||'Location not specified'}</div><div style={{color:'var(--muted)',fontSize:'.86rem'}}>{b.barangay||'Barangay not specified'} · {b.deployment_date||'Deployment date not specified'}</div></article>)}{!boothDirectory.length&&<p>No imported booth directory records. Import booth-directory.csv.</p>}</div></section>}
    {tab==='areas' && coordinator && <section className="pa-card"><div className="pa-month-head"><div><h3>Area directory · from workbook</h3><p style={{color:'var(--muted)',margin:0}}>Browse barangays, districts, team references and streets</p></div><input placeholder="Search area or street" value={areaSearch} onChange={e=>setAreaSearch(e.target.value)}/></div><div className="pa-actions" style={{margin:'1rem 0'}}><select value={areaDistrict} onChange={e=>setAreaDistrict(e.target.value)} className="pa-btn"><option>All</option>{Array.from(new Set(areaDirectory.map(a=>a.district).filter(Boolean))).sort().map(d=><option key={d}>{d}</option>)}</select><span className="pa-status">{areaDirectory.filter(a=>(areaDistrict==='All'||a.district===areaDistrict)&&(!areaSearch||(a.area_district+' '+a.street_name+' '+a.team_leader_reference).toLowerCase().includes(areaSearch.toLowerCase()))).length} streets</span></div><div className="pa-list">{areaDirectory.filter(a=>(areaDistrict==='All'||a.district===areaDistrict)&&(!areaSearch||(a.area_district+' '+a.street_name+' '+a.team_leader_reference).toLowerCase().includes(areaSearch.toLowerCase()))).map(a=><article className="pa-item" key={a.id}><div className="pa-item-head"><strong>{a.area_district}</strong><span className="pa-status">{a.district} · {a.team_leader_reference||'Unassigned'}</span></div><div>{a.street_name}</div></article>)}{!areaDirectory.length&&<p>No imported area directory records. Import area-directory.csv.</p>}</div></section>}
    {tab==='calendar' && coordinator && <section className="pa-card"><div className="pa-month-head"><div><h3>Monthly saturation calendar</h3><p style={{color:'var(--muted)',margin:0}}>Imported from SALES CALENDAR SATURATION 2026.xlsx</p></div><input aria-label="Calendar month" type="month" value={calendarMonth} onChange={e=>setCalendarMonth(e.target.value)}/></div><h2 style={{margin:'1rem 0',color:'var(--text)'}}>{monthLabel}</h2><div className="pa-list">{monthAssignments.map(a=><article className="pa-item" key={a.id}><div className="pa-item-head"><strong>{new Date(a.scheduled_date+'T00:00:00').toLocaleDateString('en-PH',{weekday:'short',month:'short',day:'numeric'})} · {leaders.find(l=>l.user_id===a.team_leader_id)?.team_leader_name || 'Team leader'}</strong><span className="pa-status">{leaders.find(l=>l.user_id===a.team_leader_id)?.district || 'Assigned'}</span></div><pre style={{whiteSpace:'pre-wrap',font:'inherit',color:'var(--muted)',margin:0}}>{a.assignment_details}</pre></article>)}{!monthAssignments.length&&<p>No spreadsheet assignments for this month.</p>}</div></section>}
    {tab==='calendar' && !coordinator && <div className="pa-list">{schedule.map(s=><article className="pa-item" key={s.id}><div className="pa-item-head"><strong>{coordinator?leaders.find(l=>l.user_id===s.team_leader_id)?.team_leader_name||'Team leader':'Your team'} · {s.activity_type}</strong><span className="pa-status">{s.scheduled_date}</span></div><div>{s.details}</div><div style={{color:'var(--muted)',fontSize:'.85rem'}}>{s.barangay||''} · {s.streets||''} · {s.location||''}</div></article>)}{!schedule.length&&<p>No approved activities yet.</p>}</div>}
  </div>
}
