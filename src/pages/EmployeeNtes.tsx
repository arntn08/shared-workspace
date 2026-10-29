import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

type Nte = { id:string; title:string; details:string; due_date:string|null; status:string; employee_response:string|null; acknowledged_at:string|null; created_at:string; responded_at:string|null; attachment_path:string|null; attachment_name:string|null }
export default function EmployeeNtes() {
  const {profile}=useAuth()
  const [items,setItems]=useState<Nte[]>([])
  const [drafts,setDrafts]=useState<Record<string,string>>({})
  const [error,setError]=useState('')
  const [busy,setBusy]=useState('')
  async function load(){
    if(!profile)return
    const {data,error:err}=await supabase.from('employee_ntes').select('id,title,details,due_date,status,employee_response,acknowledged_at,created_at,responded_at,attachment_path,attachment_name').eq('employee_id',profile.id).order('created_at',{ascending:false})
    if(err)setError(err.message);else setItems((data??[]) as Nte[])
  }
  useEffect(()=>{void load()},[profile?.id])
  async function respond(e:FormEvent,id:string){
    e.preventDefault();setBusy(id);setError('')
    const response=(drafts[id]??'').trim()
    if(!response){setError('Please enter your response first.');setBusy('');return}
    const {error:err}=await supabase.from('employee_ntes').update({employee_response:response,status:'responded',acknowledged_at:new Date().toISOString(),responded_at:new Date().toISOString()}).eq('id',id).eq('employee_id',profile?.id)
    if(err)setError(err.message);else{setDrafts(v=>({...v,[id]:''}));await load()}
    setBusy('')
  }
  async function openAttachment(n:Nte){
    if(!n.attachment_path)return
    const {data,error:err}=await supabase.storage.from('nte-attachments').createSignedUrl(n.attachment_path,60)
    if(err||!data?.signedUrl){setError(err?.message||'Could not open attachment.');return}
    window.open(data.signedUrl,'_blank','noopener,noreferrer')
  }
  return <>
    <div className="page-head"><div><h1>My Notices to Explain</h1><p className="muted" style={{margin:0}}>Private notices assigned to your account.</p></div><button className="small" onClick={()=>void load()}>Refresh</button></div>
    {error&&<p className="error">{error}</p>}
    {items.map(n=><article className="card" key={n.id} style={{marginBottom:'.75rem'}}><div className="row between" style={{alignItems:'flex-start',gap:'1rem'}}><div><h2 style={{marginTop:0}}>{n.title}</h2><p className="muted">Issued {new Date(n.created_at).toLocaleDateString()}</p></div><span className="badge">{n.status}</span></div><p style={{whiteSpace:'pre-wrap'}}>{n.details}</p>{n.due_date&&<p className="muted">Response due: {n.due_date}</p>}{n.attachment_path&&<p><button className="small" onClick={()=>void openAttachment(n)}>View attached document: {n.attachment_name||'Open file'}</button></p>}{n.status==='closed'?<p className="muted">This notice has been closed.</p>:<form className="stack" onSubmit={e=>void respond(e,n.id)}><label>Your response<textarea rows={4} required value={drafts[n.id]??n.employee_response??''} onChange={e=>setDrafts(v=>({...v,[n.id]:e.target.value}))} placeholder="Write your explanation here…"/></label><button className="primary" disabled={busy===n.id}>{busy===n.id?'Submitting…':'Submit response'}</button></form>}{n.employee_response&&n.status!=='closed'&&<p className="muted">Your response has been saved. You can update it until the notice is closed.</p>}</article>)}
    {!items.length&&!error&&<section className="card"><h2>All clear</h2><p className="muted">You do not have any notices assigned to you.</p></section>}
  </>
}