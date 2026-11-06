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
  ['/weekly-reports','Weekly Team Reports','chart'],
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
          <Route path="/weekly-reports" element={<HrWeeklyTeamReports/>}/>
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
type HrEmployee={id:string;full_name:string|null;email:string;teams:string[]|null}
const hrDate=(d:Date)=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')
const hrWeek=(d:Date)=>{const x=new Date(d);x.setDate(x.getDate()-x.getDay());return hrDate(x)}
function HrMetric({label,value,note}:{label:string;value:number;note:string}){return <article className="card" style={{padding:'1rem'}}><span className="muted">{label}</span><strong style={{display:'block',fontSize:'1.8rem',margin:'.25rem 0'}}>{value.toLocaleString()}</strong><small className="muted">{note}</small></article>}
function HrOverviewPanel(){
 const {profile}=useAuth()
 const [depts,setDepts]=useState<HrDept[]>([]),[teams,setTeams]=useState<HrTeam[]>([]),[orders,setOrders]=useState<HrOrder[]>([])
 const [employees,setEmployees]=useState(0),[pending,setPending]=useState(0),[ntes,setNtes]=useState(0),[loading,setLoading]=useState(true),[error,setError]=useState(''),[updated,setUpdated]=useState<Date|null>(null),[weekOffset,setWeekOffset]=useState(0)
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
 const selectedWeekStart=(()=>{const d=new Date();d.setDate(d.getDate()-d.getDay()-(weekOffset*7));return hrDate(d)})()
 const selectedWeekEnd=(()=>{const d=new Date(selectedWeekStart+'T12:00:00');d.setDate(d.getDate()+6);return hrDate(d)})()
 const selectedWeekOrders=done.filter(x=>x.work_date>=selectedWeekStart&&x.work_date<=selectedWeekEnd).sort((a,b)=>a.work_date.localeCompare(b.work_date)||a.wo_id.localeCompare(b.wo_id))
 const weeklyTeamRows=activeTeams.map(t=>({...t,dept:depts.find(d=>d.id===t.department_id)?.code??'—',completed:selectedWeekOrders.filter(x=>x.team_id===t.id).length})).sort((a,b)=>b.completed-a.completed||a.code.localeCompare(b.code))
 const exportWeeklyRows=()=>{const quote=(v:string)=>'"'+String(v??'').replace(/"/g,'""')+'"';const teamById=new Map(teams.map(t=>[t.id,t]));const deptById=new Map(depts.map(d=>[d.id,d]));const rows=[['Work date','Department','Team','WO ID','Status'],...selectedWeekOrders.map(o=>[o.work_date,deptById.get(o.department_id??'')?.code??'',teamById.get(o.team_id??'')?.code??'',o.wo_id,o.status])];const csv='\uFEFF'+rows.map(row=>row.map(v=>quote(String(v??''))).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download='AHBA-HR-Completed-Work-Orders-'+selectedWeekStart+'-to-'+selectedWeekEnd+'.csv';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url)}
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
  <section className="ops-panel"><div className="ops-panel-heading"><div><h2>Weekly completed by team</h2><p>Completed work orders for the selected Sunday–Saturday week</p></div><div className="row" style={{gap:'.4rem',alignItems:'center',flexWrap:'wrap'}}><button className="small" onClick={()=>setWeekOffset(x=>x+1)}>← Previous week</button><span className="ops-mini-badge">{selectedWeekStart} – {selectedWeekEnd}</span><button className="small" disabled={weekOffset===0} onClick={()=>setWeekOffset(x=>Math.max(0,x-1))}>Next week →</button><button className="small" onClick={exportWeeklyRows} disabled={!selectedWeekOrders.length}>↓ Export rows</button></div></div>
  {loading?<p className="muted">Loading…</p>:<><div style={{overflowX:'auto'}}><table className="tally-table"><thead><tr><th>Team</th><th>Department</th><th>Completed this week</th></tr></thead><tbody>{weeklyTeamRows.map(t=><tr key={t.id}><th>{t.code}</th><td>{t.dept}</td><td><strong>{t.completed}</strong></td></tr>)}</tbody><tfoot><tr><th colSpan={2}>All teams</th><td><strong>{selectedWeekOrders.length}</strong></td></tr></tfoot></table></div><details style={{marginTop:'.85rem'}}><summary style={{cursor:'pointer',fontWeight:700}}>View completed work-order rows ({selectedWeekOrders.length})</summary><div style={{overflowX:'auto',marginTop:'.6rem'}}><table className="tally-table"><thead><tr><th>Work date</th><th>Department</th><th>Team</th><th>WO ID</th><th>Status</th></tr></thead><tbody>{selectedWeekOrders.map((o,i)=><tr key={o.wo_id||i}><td>{o.work_date}</td><td>{depts.find(d=>d.id===o.department_id)?.code??'—'}</td><td>{teams.find(t=>t.id===o.team_id)?.code??'Unassigned'}</td><td>{o.wo_id}</td><td>{o.status}</td></tr>)}</tbody></table></div></details></>}</section>
  <section className="ops-panel"><div className="ops-panel-heading"><div><h2>Team performance</h2><p>Ranked by completed installations · highest volume first</p></div><span className="ops-mini-badge">MTD</span></div>{loading?<p className="muted">Loading…</p>:<div style={{overflowX:'auto'}}><table className="tally-table"><thead><tr><th>Team</th><th>Dept.</th><th>WTD</th><th>MTD completed</th><th>Incomplete</th><th>Canceled</th></tr></thead><tbody>{teamRows.map((t,i)=><tr key={t.id}><th>{i+1}. {t.code}</th><td>{t.dept}</td><td>{t.wtd}</td><td><strong>{t.mtd}</strong></td><td>{t.incomplete}</td><td>{t.canceled}</td></tr>)}</tbody></table></div>}<p className="muted" style={{fontSize:'.75rem'}}>Volume comparison only; this is not an individual employee rating or disciplinary score.</p></section>
  <div className="ops-overview-columns"><article className="ops-panel"><div className="ops-panel-heading"><div><h2>HR follow-ups</h2><p>Items requiring attention</p></div></div><Link className="ops-shortcut" to="/leave"><span className="ops-shortcut-icon">▦</span><span><strong>Leave requests</strong><small>{pending} pending decision(s)</small></span><b>→</b></Link><Link className="ops-shortcut" to="/ntes"><span className="ops-shortcut-icon">▤</span><span><strong>Notices to Explain</strong><small>{ntes} open notice(s)</small></span><b>→</b></Link></article>
  <article className="ops-panel"><div className="ops-panel-heading"><div><h2>Quick access</h2><p>People operations</p></div></div><Link className="ops-shortcut" to="/schedule"><span className="ops-shortcut-icon">▦</span><span><strong>Team schedules</strong><small>View rosters and schedules</small></span><b>→</b></Link><Link className="ops-shortcut" to="/files"><span className="ops-shortcut-icon">▱</span><span><strong>Files & resources</strong><small>Shared company resources</small></span><b>→</b></Link><Link className="ops-shortcut" to="/tally"><span className="ops-shortcut-icon">▥</span><span><strong>Installation tally</strong><small>Detailed weekly and monthly totals</small></span><b>→</b></Link></article></div>
  <p className="muted" style={{fontSize:'.75rem',textAlign:'right'}}>Auto-refreshes every minute{updated?' · Last updated '+updated.toLocaleTimeString('en-PH'):''}</p>
 </section>
}

function HrWeeklyTeamReports(){
 const [depts,setDepts]=useState<HrDept[]>([])
 const [teams,setTeams]=useState<HrTeam[]>([])
 const [orders,setOrders]=useState<HrOrder[]>([])
 const [employees,setEmployees]=useState<HrEmployee[]>([])
 const [showEmployeeReport,setShowEmployeeReport]=useState(false)
 const [employeeSearch,setEmployeeSearch]=useState('')
 const [departmentFilter,setDepartmentFilter]=useState('all')
 const [weekOffset,setWeekOffset]=useState(0)
 const [loading,setLoading]=useState(true)
 const [error,setError]=useState('')
 const [updated,setUpdated]=useState<Date|null>(null)
 const selectedWeekStart=(()=>{const d=new Date();d.setDate(d.getDate()-d.getDay()-(weekOffset*7));return hrDate(d)})()
 const selectedWeekEnd=(()=>{const d=new Date(selectedWeekStart+'T12:00:00');d.setDate(d.getDate()+6);return hrDate(d)})()
 async function load(){
  setLoading(true);setError('')
  const [d,t,p]=await Promise.all([
   supabase.from('installation_departments').select('id,code,name,active').order('code'),
   supabase.from('installation_teams').select('id,department_id,code,name,active').order('code'),
   supabase.from('profiles').select('id,full_name,email,teams').eq('role','employee').eq('active',true).order('full_name')
  ])
  if(d.error||t.error||p.error){setError([d.error?.message,t.error?.message,p.error?.message].filter(Boolean).join(' · '));setLoading(false);return}
  const all:HrOrder[]=[];let offset=0,problem=''
  while(true){
   const q=await supabase.from('installation_imported_work_orders').select('work_date,team_id,department_id,status,wo_id').gte('work_date',selectedWeekStart).lte('work_date',selectedWeekEnd).order('work_date').order('wo_id').range(offset,offset+999)
   if(q.error){problem=q.error.message;break}
   const rows=(q.data??[]) as HrOrder[];all.push(...rows);if(rows.length<1000)break;offset+=1000
  }
  setDepts((d.data??[]) as HrDept[]);setTeams((t.data??[]) as HrTeam[]);setEmployees((p.data??[]) as HrEmployee[])
  if(problem)setError(problem);else setOrders(all.filter(x=>x.status.trim().toUpperCase()==='COMPLETED'))
  setUpdated(new Date());setLoading(false)
 }
 useEffect(()=>{void load()},[selectedWeekStart,selectedWeekEnd])
 const activeTeams=teams.filter(t=>t.active)
 const weeklyRows=activeTeams.map(t=>({ ...t,department:depts.find(d=>d.id===t.department_id)?.code??'—',records:orders.filter(o=>o.team_id===t.id),count:orders.filter(o=>o.team_id===t.id).length })).sort((a,b)=>b.count-a.count||a.code.localeCompare(b.code))
 const employeeAssignments=useMemo(()=>employees.flatMap(employee=>(employee.teams??[]).flatMap(teamValue=>{const key=String(teamValue).trim().toLowerCase();const team=teams.find(t=>[t.id,t.code,t.name].some(v=>String(v??'').trim().toLowerCase()===key));return team?[{employee,team}]:[]})),[employees,teams])
 const employeeReportRows=useMemo(()=>employees.flatMap(employee=>{const assignments=employeeAssignments.filter(x=>x.employee.id===employee.id);const deptIds=[...new Set(assignments.map(x=>x.team.department_id))];return deptIds.map(deptId=>{const dept=depts.find(d=>d.id===deptId);const assigned=assignments.filter(x=>x.team.department_id===deptId);const teamIds=new Set(assigned.map(x=>x.team.id));const employeeOrders=orders.filter(o=>teamIds.has(o.team_id??''));const days=Array.from(new Set(employeeOrders.map(o=>o.work_date))).sort().map(day=>({day,count:employeeOrders.filter(o=>o.work_date===day).length}));return {id:employee.id+'|'+deptId,employee,department:dept?.code??'—',departmentId:deptId,teams:assigned.map(x=>x.team.code).join(', '),days,total:employeeOrders.length}})}).sort((a,b)=>String(a.employee.full_name??a.employee.email).localeCompare(String(b.employee.full_name??b.employee.email))||a.department.localeCompare(b.department)),[employees,employeeAssignments,orders,depts])
 const filteredEmployeeRows=employeeReportRows.filter(row=>(departmentFilter==='all'||row.departmentId===departmentFilter)&&[row.employee.full_name,row.employee.email,row.teams,row.department].some(value=>String(value??'').toLowerCase().includes(employeeSearch.trim().toLowerCase())))
 const exportRows=()=>{const quote=(v:string)=>'"'+String(v??'').replace(/"/g,'""')+'"';const deptById=new Map(depts.map(d=>[d.id,d]));const teamById=new Map(teams.map(t=>[t.id,t]));const employeeByTeam=new Map<string,HrEmployee[]>();for(const item of employeeAssignments){const list=employeeByTeam.get(item.team.id)??[];list.push(item.employee);employeeByTeam.set(item.team.id,list)}const rows=[['Work date','Department','Team','Employee','WO ID','Status'],...orders.flatMap(o=>(employeeByTeam.get(o.team_id??'')??[]).map(employee=>[o.work_date,deptById.get(o.department_id??'')?.code??'',teamById.get(o.team_id??'')?.code??'Unassigned',employee.full_name??employee.email,o.wo_id,o.status]))];const csv='\uFEFF'+rows.map(row=>row.map(v=>quote(String(v??''))).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download='AHBA-Weekly-Employee-Completed-Attribution-'+selectedWeekStart+'-to-'+selectedWeekEnd+'.csv';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url)}
 return <section className="ops-overview" style={{display:'grid',gap:'1rem'}}>
  <div className="ops-overview-heading"><div><span className="ops-eyebrow">HR REPORTING</span><h1>Weekly Team Reports</h1><p>Completed work orders by team · Sunday–Saturday</p></div><button className="small" onClick={()=>void load()}>↻ Refresh</button></div>
  {error&&<div className="notice error">{error}</div>}
  <section className="ops-panel"><div className="ops-panel-heading"><div><h2>Reporting week</h2><p>{selectedWeekStart} through {selectedWeekEnd}</p></div><div className="row" style={{gap:'.5rem',flexWrap:'wrap'}}><button className="small" onClick={()=>setWeekOffset(x=>x+1)}>← Previous week</button><button className="small" disabled={weekOffset===0} onClick={()=>setWeekOffset(x=>Math.max(0,x-1))}>Next week →</button><button className="small" disabled={loading||orders.length===0} onClick={exportRows}>↓ Export CSV</button></div></div>
   {loading?<p className="muted">Loading weekly records…</p>:<><div className="grid cols-3"><HrMetric label="Completed work orders" value={orders.length} note="Selected Sunday–Saturday week"/><HrMetric label="Active teams" value={activeTeams.length} note="Configured active teams"/><HrMetric label="Teams with completions" value={weeklyRows.filter(t=>t.count>0).length} note="At least one completed order"/></div>
   <div style={{overflowX:'auto',marginTop:'1rem'}}><table className="tally-table"><thead><tr><th>Team</th><th>Department</th><th>Completed this week</th></tr></thead><tbody>{weeklyRows.map(t=><tr key={t.id}><th>{t.code}</th><td>{t.department}</td><td><strong>{t.count}</strong></td></tr>)}</tbody><tfoot><tr><th colSpan={2}>All teams</th><td><strong>{orders.length}</strong></td></tr></tfoot></table></div>
   <div className="ops-panel" style={{marginTop:'1rem'}}><div className="ops-panel-heading"><div><h2>Employee reports</h2><p>View completed work orders under each employee instead of grouping the report by team.</p></div><button className="small" onClick={()=>setShowEmployeeReport(true)}>Open employee report</button></div><p className="tally-note">Each completed work order is credited to every active employee assigned to that team. Team and overall totals continue to count each work order only once.</p></div>
   {showEmployeeReport&&<div role="dialog" aria-modal="true" aria-labelledby="hr-employee-report-title" onClick={e=>{if(e.target===e.currentTarget)setShowEmployeeReport(false)}} style={{position:'fixed',inset:0,zIndex:1000,background:'rgba(8,15,12,.68)',display:'grid',placeItems:'center',padding:'1rem'}}><section className="ops-panel" style={{width:'min(1100px,100%)',maxHeight:'88vh',overflowY:'auto',boxShadow:'0 24px 80px rgba(0,0,0,.35)'}}><div className="ops-panel-heading"><div><span className="ops-eyebrow">HR REPORTING</span><h2 id="hr-employee-report-title">Daily completed by employee</h2><p>{selectedWeekStart} through {selectedWeekEnd}</p></div><button className="small" onClick={()=>setShowEmployeeReport(false)}>Close ✕</button></div><div className="row" style={{gap:'.65rem',flexWrap:'wrap',margin:'1rem 0'}}><input aria-label="Search employees" placeholder="Search employee name, email, team…" value={employeeSearch} onChange={e=>setEmployeeSearch(e.target.value)} style={{flex:'1 1 260px',minWidth:0}}/><select aria-label="Filter by department" value={departmentFilter} onChange={e=>setDepartmentFilter(e.target.value)} style={{flex:'0 1 230px'}}><option value="all">All departments</option>{depts.filter(d=>d.active).map(d=><option key={d.id} value={d.id}>{d.code} — {d.name}</option>)}</select><button className="small" onClick={()=>{setEmployeeSearch('');setDepartmentFilter('all')}}>Clear filters</button></div><div style={{overflowX:'auto'}}><table className="tally-table"><thead><tr><th>Employee</th><th>Department</th><th>Assigned team</th><th>Daily completed</th><th>Weekly total</th></tr></thead><tbody>{filteredEmployeeRows.map(row=><tr key={row.id}><th>{row.employee.full_name||row.employee.email}<div className="muted" style={{fontWeight:400,fontSize:'.75rem'}}>{row.employee.email}</div></th><td>{row.department}</td><td>{row.teams||'—'}</td><td>{row.days.length?row.days.map(day=><div key={day.day} style={{whiteSpace:'nowrap'}}>{day.day}: <strong>{day.count}</strong></div>):'0'}</td><td><strong>{row.total}</strong></td></tr>)}{filteredEmployeeRows.length===0&&<tr><td colSpan={5} className="muted">No employees match this search and department filter.</td></tr>}</tbody></table></div><p className="tally-note">Employee totals are attributed from their assigned team's completed work orders. If two employees share a team, both see the same team completion count; the team-level totals are not doubled.</p></section></div>}
   <details style={{marginTop:'1rem'}} open><summary style={{cursor:'pointer',fontWeight:700}}>Completed work-order rows ({orders.length})</summary><div style={{overflowX:'auto',marginTop:'.75rem'}}><table className="tally-table"><thead><tr><th>Work date</th><th>Department</th><th>Team</th><th>WO ID</th><th>Status</th></tr></thead><tbody>{orders.map((o,i)=><tr key={o.wo_id||i}><td>{o.work_date}</td><td>{depts.find(d=>d.id===o.department_id)?.code??'—'}</td><td>{teams.find(t=>t.id===o.team_id)?.code??'Unassigned'}</td><td>{o.wo_id}</td><td>{o.status}</td></tr>)}</tbody></table></div></details></>}
  </section>
  <p className="muted" style={{fontSize:'.75rem',textAlign:'right'}}>Only COMPLETED records are included{updated?' · Updated '+updated.toLocaleTimeString('en-PH'):''}</p>
 </section>
}

function nowMonthLabel(){return new Date().toLocaleDateString('en-PH',{month:'long',year:'numeric'})}
