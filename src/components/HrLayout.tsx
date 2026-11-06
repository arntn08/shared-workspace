import { useEffect, useMemo, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useSettings } from '../lib/settings'
import { Avatar, Icon, ThemeButton } from './Nav'
import HrTeamSchedule from '../pages/HrTeamSchedule'
import HrNtes from '../pages/HrNtes'
import Settings from '../pages/Settings'
import EmployeeFiles from '../pages/EmployeeFiles'
import FileViewer from '../pages/FileViewer'
import Tally from '../pages/Tally'
import ARGenerator from '../pages/ARGenerator'
import LeaveRequests from '../pages/LeaveRequests'
import { supabase } from '../lib/supabase'

const links = [
  ['/','HR overview','home'],
  ['/schedule','Team schedules','schedule'],
  ['/ar','AR Generator','receipt'],
  ['/ntes','Notices to Explain','file-text'],
  ['/leave','Leave requests','calendar'],
  ['/tally','Installation Tally','tally'],
  ['/files','Files & resources','files'],
  ['/settings','Settings','settings']
] as const

export default function HrLayout() {
  const { profile, signOut } = useAuth()
  const [settings] = useSettings()
  const location = useLocation()
  const navigate = useNavigate()
  const current = links.find(([to]) => to === '/' ? location.pathname === '/' : location.pathname.startsWith(to))?.[1] ?? 'HR portal'

  return <div className="ops-shell employee-ops-shell role-theme-hr">
    <aside className="ops-sidebar">
      <div className="ops-brand"><div className="ops-brand-mark">A</div><div className="ops-brand-copy"><strong>AHBA</strong><span>{settings.title || 'Development Workspace'}</span></div></div>
      <div className="ops-workspace-label">HR PORTAL</div>
      <nav className="ops-nav" aria-label="HR navigation">
        <div className="ops-nav-group"><div className="ops-nav-heading">People operations</div>
          {links.map(([to,label,icon]) => <NavLink key={to} to={to} end={to === '/'} className={({isActive}) => `ops-nav-link${isActive ? ' active' : ''}`}><span className="ops-nav-icon"><Icon name={icon} /></span><span className="ops-nav-label">{label}</span></NavLink>)}
        </div>
      </nav>
      <div className="ops-sidebar-bottom"><div className="ops-help-card"><span className="ops-help-icon">✦</span><div><strong>Restricted access</strong><span>HR permissions</span></div></div>
        <div className="ops-profile"><Avatar name={profile?.full_name} email={profile?.email}/><div className="ops-profile-copy"><strong>{profile?.full_name || profile?.email}</strong><span>HR</span></div><ThemeButton/><button className="ops-icon-button" onClick={async()=>{await signOut();navigate('/',{replace:true})}} title="Sign out" aria-label="Sign out"><Icon name="out"/></button></div>
      </div>
    </aside>
    <main className="ops-main"><header className="ops-topbar"><div className="ops-breadcrumb"><span>AHBA WORKSPACE</span><span className="ops-breadcrumb-divider">/</span><strong>{current}</strong></div><div className="ops-topbar-right"><span className="ops-status-dot"/><span className="ops-status-label">Workspace connected</span><span className="ops-role-pill">HR</span></div></header>
      <div className="ops-page employee-ops-page">
        <Routes>
          <Route path="/" element={<HrOverviewPanel/>}/>
          <Route path="/schedule" element={<HrTeamSchedule/>}/>
          <Route path="/ar" element={<ARGenerator/>}/>
          <Route path="/ntes" element={<HrNtes/>}/>
          <Route path="/leave" element={<LeaveRequests/>}/>
          <Route path="/tally" element={<Tally/>}/>
          <Route path="/files" element={<EmployeeFiles settings={settings} />}/>
          <Route path="/file/:id" element={<FileViewer/>}/>
          <Route path="/settings" element={<Settings/>}/>
          <Route path="*" element={<Navigate to="/" replace/>}/>
        </Routes>
        <footer className="emp-footer"><span>AHBA Development</span><span>Shared Workspace · HR Portal</span></footer>
      </div>
    </main>
  </div>
}
type HrDept={id:string;code:string;name:string;active:boolean}
type HrTeam={id:string;department_id:string;code:string;name:string;active:boolean}
type HrOrder={work_date:string;team_id:string|null;department_id:string|null;status:string;wo_id:string}
const hrDate=(d:Date)=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')
const hrWeek=(d:Date)=>{const x=new Date(d);x.setDate(x.getDate()-x.getDay());return hrDate(x)}
function HrMetric({label,value,note}:{label:string;value:number;note:string}){return <article className="card" style={{padding:'1rem'}}><span className="muted">{label}</span><strong style={{display:'block',fontSize:'1.8rem',margin:'.25rem 0'}}>{value.toLocaleString()}</strong><small className="muted">{note}</small></article>}
function HrOverviewPanel(){
 const {profile}=useAuth()
 const [depts,setDepts]=useState<HrDept[]>([]),[teams,setTeams]=useState<HrTeam[]>([]),[orders,setOrders]=useState<HrOrder[]>([])
 const [employees,setEmployees]=useState(0),[pending,setPending]=useState(0),[ntes,setNtes]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState(''),[updated,setUpdated]=useState<Date|null>(null)
 async function load(){
  setError('')
  const now=new Date(),today=hrDate(now),start=today.slice(0,7)+'-01'
  const [d,t,p,l,n]=await Promise.all([
   supabase.from('installation_departments').select('id,code,name,active').order('code'),
   supabase.from('installation_teams').select('id,department_id,code,name,active').order('code'),
   supabase.from('profiles').select('id',{count:'exact',head:true}).eq('role','employee').eq('active',true),
   supabase.from('employee_leave_requests').select('id',{count:'exact',head:true}).eq('status','pending'),
   supabase.from('employee_ntes').select('id',{count:'exact',head:true}).neq('status','closed')
  ])
  const problems=[d.error?.message,t.error?.message,p.error?.message,l.error?.message,n.error?.message].filter(Boolean)
  if(!d.error)setDepts((d.data??[]) as HrDept[]);if(!t.error)setTeams((t.data??[]) as HrTeam[])
  if(!p.error)setEmployees(p.count??0);if(!l.error)setPending(l.count??0);if(!n.error)setNtes(n.count??0)
  const all:HrOrder[]=[];let offset=0,orderError=''
  while(true){const q=await supabase.from('installation_imported_work_orders').select('work_date,team_id,department_id,status,wo_id').gte('work_date',start).lte('work_date',today).order('wo_id').range(offset,offset+999);if(q.error){orderError=q.error.message;break}const rows=(q.data??[]) as HrOrder[];all.push(...rows);if(rows.length<1000)break;offset+=1000}
  if(!orderError)setOrders(all)
  if(problems.length||orderError)setError([...problems,orderError].filter(Boolean).join(' · '))
  setUpdated(new Date());setLoading(false)
 }
 useEffect(()=>{void load();const id=window.setInterval(()=>void load(),60000);return()=>window.clearInterval(id)},[])
 const activeTeams=teams.filter(x=>x.active),activeDepts=depts.filter(x=>x.active)
 const done=orders.filter(x=>x.status.trim().toUpperCase()==='COMPLETED'),incomplete=orders.filter(x=>x.status.trim().toUpperCase()==='INCOMPLETE'),canceled=orders.filter(x=>x.status.trim().toUpperCase()==='CANCELED')
 const wtd=done.filter(x=>x.work_date>=hrWeek(new Date())).length
 const deptRows=activeDepts.map(d=>{const rows=orders.filter(x=>x.department_id===d.id);return {...d,teamCount:activeTeams.filter(t=>t.department_id===d.id).length,completed:rows.filter(x=>x.status.toUpperCase()==='COMPLETED').length,incomplete:rows.filter(x=>x.status.toUpperCase()==='INCOMPLETE').length,canceled:rows.filter(x=>x.status.toUpperCase()==='CANCELED').length}}).sort((a,b)=>b.completed-a.completed)
 const teamRows=activeTeams.map(t=>{const rows=orders.filter(x=>x.team_id===t.id),finished=rows.filter(x=>x.status.toUpperCase()==='COMPLETED');return {...t,dept:depts.find(d=>d.id===t.department_id)?.code??'—',wtd:finished.filter(x=>x.work_date>=hrWeek(new Date())).length,mtd:finished.length,incomplete:rows.filter(x=>x.status.toUpperCase()==='INCOMPLETE').length,canceled:rows.filter(x=>x.status.toUpperCase()==='CANCELED').length}}).sort((a,b)=>b.mtd-a.mtd||a.code.localeCompare(b.code))
 const days=Array.from({length:7},(_,i)=>{const d=new Date();d.setDate(d.getDate()-(6-i));const key=hrDate(d);return {key,label:d.toLocaleDateString('en-PH',{weekday:'short'}),count:done.filter(x=>x.work_date===key).length}})
 const max=Math.max(1,...days.map(x=>x.count)),first=profile?.full_name?.trim().split(/\s+/)[0]||'there'
 return <section className="ops-overview" style={{display:'grid',gap:'1rem'}}>
  <div className="ops-overview-heading"><div><span className="ops-eyebrow">PEOPLE OPERATIONS</span><h1>HR overview, {first}.</h1><p>{new Date().toLocaleDateString('en-PH',{weekday:'long',month:'long',day:'numeric',year:'numeric'})} · Workforce and team performance.</p></div><button className="small" onClick={()=>void load()}>↻ Refresh</button></div>
  {error&&<div className="notice error">{error}</div>}
  <section className="card" style={{padding:'1.2rem',background:'linear-gradient(120deg,rgba(24,91,62,.13),rgba(190,157,91,.10))'}}><span className="ops-eyebrow">HR OPERATIONS CENTER</span><h2 style={{margin:'.35rem 0'}}>People first. Teams in sync.</h2><p className="muted">Monitor team output, follow up on employee requests, and keep schedules organized.</p><div className="row" style={{gap:'.5rem',flexWrap:'wrap'}}><Link className="btn primary" to="/leave">Review leave requests</Link><Link className="btn" to="/schedule">View team schedules</Link></div></section>
  <div><h2>Workforce & HR workload</h2><div className="grid cols-3">
   <HrMetric label="Active employees" value={employees} note="Enabled employee accounts"/><HrMetric label="Active teams" value={activeTeams.length} note={activeDepts.length+' active departments'}/><HrMetric label="Pending leave" value={pending} note="Awaiting HR decision"/><HrMetric label="Open NTEs" value={ntes} note="Notices not yet closed"/><HrMetric label="Completed · WTD" value={wtd} note="Sunday through today"/><HrMetric label="Completed · MTD" value={done.length} note={nowMonthLabel()}/>
  </div></div>
  <div className="ops-overview-columns"><article className="ops-panel"><div className="ops-panel-heading"><div><h2>Installation activity</h2><p>Completed work orders · last 7 days</p></div></div><div className="ops-chart">{days.map(x=><div className="ops-chart-column" key={x.key}><strong>{x.count}</strong><div className="ops-chart-track"><span style={{height:(x.count?Math.max(8,x.count/max*100):3)+'%'}}/></div><span className="ops-chart-label">{x.label}</span></div>)}</div></article>
  <article className="ops-panel"><div className="ops-panel-heading"><div><h2>Work-order status</h2><p>Imported records · current month</p></div></div><div className="grid cols-3" style={{gap:'.5rem'}}><div className="card"><small className="muted">Completed</small><h2>{done.length}</h2></div><div className="card"><small className="muted">Incomplete</small><h2>{incomplete.length}</h2></div><div className="card"><small className="muted">Canceled</small><h2>{canceled.length}</h2></div></div><p className="muted" style={{fontSize:'.75rem'}}>WTD and MTD count COMPLETED only.</p></article></div>
  <section className="ops-panel"><div className="ops-panel-heading"><div><h2>Department performance</h2><p>Month-to-date work-order status</p></div><Link to="/tally" className="ops-text-link">Open installation tally →</Link></div>{loading?<p className="muted">Loading…</p>:<div style={{overflowX:'auto'}}><table className="tally-table"><thead><tr><th>Department</th><th>Teams</th><th>Completed</th><th>Incomplete</th><th>Canceled</th></tr></thead><tbody>{deptRows.map(d=><tr key={d.id}><th>{d.code} · {d.name}</th><td>{d.teamCount}</td><td><strong>{d.completed}</strong></td><td>{d.incomplete}</td><td>{d.canceled}</td></tr>)}</tbody></table></div>}</section>
  <section className="ops-panel"><div className="ops-panel-heading"><div><h2>Team performance</h2><p>Ranked by completed installations · highest volume first</p></div><span className="ops-mini-badge">MTD</span></div>{loading?<p className="muted">Loading…</p>:<div style={{overflowX:'auto'}}><table className="tally-table"><thead><tr><th>Team</th><th>Dept.</th><th>WTD</th><th>MTD completed</th><th>Incomplete</th><th>Canceled</th></tr></thead><tbody>{teamRows.map((t,i)=><tr key={t.id}><th>{i+1}. {t.code}</th><td>{t.dept}</td><td>{t.wtd}</td><td><strong>{t.mtd}</strong></td><td>{t.incomplete}</td><td>{t.canceled}</td></tr>)}</tbody></table></div>}<p className="muted" style={{fontSize:'.75rem'}}>Volume comparison only; this is not an individual employee rating or disciplinary score.</p></section>
  <div className="ops-overview-columns"><article className="ops-panel"><div className="ops-panel-heading"><div><h2>HR follow-ups</h2><p>Items requiring attention</p></div></div><Link className="ops-shortcut" to="/leave"><span className="ops-shortcut-icon">▦</span><span><strong>Leave requests</strong><small>{pending} pending decision(s)</small></span><b>→</b></Link><Link className="ops-shortcut" to="/ntes"><span className="ops-shortcut-icon">▤</span><span><strong>Notices to Explain</strong><small>{ntes} open notice(s)</small></span><b>→</b></Link></article>
  <article className="ops-panel"><div className="ops-panel-heading"><div><h2>Quick access</h2><p>People operations</p></div></div><Link className="ops-shortcut" to="/schedule"><span className="ops-shortcut-icon">▦</span><span><strong>Team schedules</strong><small>View rosters and schedules</small></span><b>→</b></Link><Link className="ops-shortcut" to="/files"><span className="ops-shortcut-icon">▱</span><span><strong>Files & resources</strong><small>Shared company resources</small></span><b>→</b></Link><Link className="ops-shortcut" to="/tally"><span className="ops-shortcut-icon">▥</span><span><strong>Installation tally</strong><small>Detailed weekly and monthly totals</small></span><b>→</b></Link></article></div>
  <p className="muted" style={{fontSize:'.75rem',textAlign:'right'}}>Auto-refreshes every minute{updated?' · Last updated '+updated.toLocaleTimeString('en-PH'):''}</p>
 </section>
}
function nowMonthLabel(){return new Date().toLocaleDateString('en-PH',{month:'long',year:'numeric'})}
