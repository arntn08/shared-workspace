import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

type Person = { id: string; full_name: string | null; email: string; role: string; active: boolean; teams?: string[] }
type Nte = { id: string; employee_id: string; title: string; details: string; due_date: string | null; status: string; employee_response: string | null; created_at: string; profiles?: { full_name: string | null; email: string } }

export default function HrNtes() {
  const { profile } = useAuth()
  const [people,setPeople] = useState<Person[]>([])
  const [items,setItems] = useState<Nte[]>([])
  const [employee,setEmployee] = useState('')
  const [title,setTitle] = useState('')
  const [details,setDetails] = useState('')
  const [due,setDue] = useState('')
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [message,setMessage] = useState('')

  async function load() {
    setError('')
    const [p,n] = await Promise.all([
      supabase.from('profiles').select('id,full_name,email,role,active,teams').eq('active',true).eq('role','employee').order('full_name'),
      supabase.from('employee_ntes').select('id,employee_id,title,details,due_date,status,employee_response,created_at,profiles:employee_id(full_name,email)').order('created_at',{ascending:false})
    ])
    if (p.error) setError(p.error.message)
    else setPeople((p.data ?? []) as Person[])
    if (n.error) setError(n.error.message + ' — if this is the first visit, run the HR NTE migration in Supabase.')
    else setItems((n.data ?? []) as unknown as Nte[])
  }
  useEffect(()=>{ void load() },[])

  async function issue(e: FormEvent) {
    e.preventDefault()
    if (!profile || !employee) return
    setBusy(true); setError(''); setMessage('')
    const {error:err} = await supabase.from('employee_ntes').insert({employee_id:employee,created_by:profile.id,title:title.trim(),details:details.trim(),due_date:due || null})
    if (err) setError(err.message)
    else { setMessage('NTE issued. It is visible to HR and the assigned employee in the portal.'); setTitle('');setDetails('');setDue('');await load() }
    setBusy(false)
  }

  async function closeNte(id:string) {
    const {error:err} = await supabase.from('employee_ntes').update({status:'closed'}).eq('id',id)
    if(err) setError(err.message); else await load()
  }

  return <>
    <div className="page-head"><div><h1>Notices to Explain</h1><p className="muted" style={{margin:0}}>Issue a private notice to one employee and review their response.</p></div></div>
    <section className="card" style={{marginBottom:'1rem'}}><h2>Issue a new NTE</h2>
      <form onSubmit={issue} className="stack">
        <label>Employee<select value={employee} onChange={e=>setEmployee(e.target.value)} required><option value="">Choose employee</option>{people.map(p=><option key={p.id} value={p.id}>{p.full_name || p.email}{p.teams?.length ? ' · '+p.teams.join(', ') : ''}</option>)}</select></label>
        <label>Subject<input value={title} onChange={e=>setTitle(e.target.value)} maxLength={160} required placeholder="e.g. Attendance clarification"/></label>
        <label>Details<textarea value={details} onChange={e=>setDetails(e.target.value)} rows={5} required placeholder="Explain the concern and what response is requested."/></label>
        <label>Response due date<input type="date" value={due} onChange={e=>setDue(e.target.value)}/></label>
        {error && <p className="error">{error}</p>}{message && <p className="notice">{message}</p>}
        <div><button className="primary" disabled={busy}>{busy?'Issuing…':'Issue private NTE'}</button></div>
      </form>
    </section>
    <div className="page-head"><div><h2>Issued notices</h2><p className="muted">Responses are only visible to HR/owner and the assigned employee.</p></div><button className="small" onClick={()=>void load()}>Refresh</button></div>
    {items.map(n=><article className="card" key={n.id} style={{marginBottom:'.75rem'}}><div className="row between" style={{gap:'1rem',alignItems:'flex-start'}}><div><h3 style={{marginTop:0}}>{n.title}</h3><p className="muted">{n.profiles?.full_name || n.profiles?.email || 'Assigned employee'} · Issued {new Date(n.created_at).toLocaleDateString()}</p></div><span className="badge">{n.status}</span></div><p style={{whiteSpace:'pre-wrap'}}>{n.details}</p>{n.due_date && <p className="muted">Response due: {n.due_date}</p>}{n.employee_response && <div className="notice"><strong>Employee response</strong><p style={{whiteSpace:'pre-wrap'}}>{n.employee_response}</p></div>}{n.status!=='closed' && <button className="small" onClick={()=>void closeNte(n.id)}>Close notice</button>}</article>)}
    {!items.length && !error && <p className="muted">No NTEs have been issued.</p>}
  </>
}