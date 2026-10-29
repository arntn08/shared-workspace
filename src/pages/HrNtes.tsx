import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

type Person = { id: string; full_name: string | null; email: string; role: string; active: boolean; teams?: string[] }
type Nte = { id: string; employee_id: string; title: string; details: string; due_date: string | null; status: string; employee_response: string | null; created_at: string; attachment_path: string | null; attachment_name: string | null; attachment_type: string | null; profiles?: { full_name: string | null; email: string } }

export default function HrNtes() {
  const { profile } = useAuth()
  const [people,setPeople] = useState<Person[]>([])
  const [items,setItems] = useState<Nte[]>([])
  const [employee,setEmployee] = useState('')
  const [title,setTitle] = useState('')
  const [details,setDetails] = useState('')
  const [due,setDue] = useState('')
  const [attachment,setAttachment] = useState<File | null>(null)
  const [busy,setBusy] = useState(false)
  const [error,setError] = useState('')
  const [message,setMessage] = useState('')

  async function load() {
    setError('')
    const [p,n] = await Promise.all([
      supabase.from('profiles').select('id,full_name,email,role,active,teams').eq('active',true).eq('role','employee').order('full_name'),
      supabase.from('employee_ntes').select('id,employee_id,title,details,due_date,status,employee_response,created_at,attachment_path,attachment_name,attachment_type,profiles:employee_id(full_name,email)').order('created_at',{ascending:false})
    ])
    if (p.error) setError(p.error.message)
    else setPeople((p.data ?? []) as Person[])
    if (n.error) setError(n.error.message + ' — check that the NTE attachment migration has been run in Supabase.')
    else setItems((n.data ?? []) as unknown as Nte[])
  }
  useEffect(()=>{ void load() },[])

  async function issue(e: FormEvent) {
    e.preventDefault()
    if (!profile || !employee) return
    if (attachment && attachment.size > 10 * 1024 * 1024) { setError('Attachment must be 10 MB or smaller.'); return }
    if (attachment && !['application/pdf','image/jpeg','image/png','image/webp'].includes(attachment.type)) { setError('Attach a PDF, JPG, PNG, or WebP image.'); return }
    setBusy(true); setError(''); setMessage('')
    const {data:created,error:insertError} = await supabase.from('employee_ntes').insert({employee_id:employee,created_by:profile.id,title:title.trim(),details:details.trim(),due_date:due || null}).select('id').single()
    if (insertError || !created) {
      setError(insertError?.message || 'Could not create the NTE.')
      setBusy(false); return
    }
    if (attachment) {
      const safeName = attachment.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g,'_').slice(-100) || 'attachment'
      const path = `nte/${created.id}/${Date.now()}-${safeName}`
      const {error:uploadError} = await supabase.storage.from('nte-attachments').upload(path,attachment,{contentType:attachment.type,upsert:false})
      if (uploadError) {
        setError('The NTE was created, but its attachment failed to upload: ' + uploadError.message)
        setMessage('Please retry by issuing the notice again without the attachment, or contact the workspace owner to check Storage setup.')
        setBusy(false); await load(); return
      }
      const {error:updateError} = await supabase.from('employee_ntes').update({attachment_path:path,attachment_name:attachment.name,attachment_type:attachment.type}).eq('id',created.id)
      if (updateError) {
        setError('The NTE was created and file uploaded, but saving the attachment details failed: ' + updateError.message)
        setBusy(false); await load(); return
      }
    }
    setMessage('NTE issued' + (attachment ? ' with attachment' : '') + '. It is visible to HR and the assigned employee.')
    setTitle('');setDetails('');setDue('');setAttachment(null)
    const input = document.getElementById('nte-attachment') as HTMLInputElement | null
    if (input) input.value = ''
    await load()
    setBusy(false)
  }

  async function openAttachment(n:Nte) {
    if (!n.attachment_path) return
    const {data,error:err} = await supabase.storage.from('nte-attachments').createSignedUrl(n.attachment_path,60)
    if(err || !data?.signedUrl) { setError(err?.message || 'Could not open attachment.'); return }
    window.open(data.signedUrl,'_blank','noopener,noreferrer')
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
        <label>Attach document or picture <span className="muted">(optional · PDF, JPG, PNG, WebP · max 10 MB)</span><input id="nte-attachment" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={e=>setAttachment(e.target.files?.[0] ?? null)}/></label>
        {attachment && <p className="muted">Selected: {attachment.name} · {(attachment.size/1024/1024).toFixed(2)} MB <button type="button" className="small" onClick={()=>{setAttachment(null);const input=document.getElementById('nte-attachment') as HTMLInputElement|null;if(input)input.value=''}}>Remove</button></p>}
        <label>Response due date<input type="date" value={due} onChange={e=>setDue(e.target.value)}/></label>
        {error && <p className="error">{error}</p>}{message && <p className="notice">{message}</p>}
        <div><button className="primary" disabled={busy}>{busy?'Issuing…':'Issue private NTE'}</button></div>
      </form>
    </section>
    <div className="page-head"><div><h2>Issued notices</h2><p className="muted">Responses and attachments are only visible to HR/owner and the assigned employee.</p></div><button className="small" onClick={()=>void load()}>Refresh</button></div>
    {items.map(n=><article className="card" key={n.id} style={{marginBottom:'.75rem'}}><div className="row between" style={{gap:'1rem',alignItems:'flex-start'}}><div><h3 style={{marginTop:0}}>{n.title}</h3><p className="muted">{n.profiles?.full_name || n.profiles?.email || 'Assigned employee'} · Issued {new Date(n.created_at).toLocaleDateString()}</p></div><span className="badge">{n.status}</span></div><p style={{whiteSpace:'pre-wrap'}}>{n.details}</p>{n.due_date && <p className="muted">Response due: {n.due_date}</p>}{n.attachment_path && <p><button className="small" onClick={()=>void openAttachment(n)}>View attachment: {n.attachment_name || 'Open file'}</button></p>}{n.employee_response && <div className="notice"><strong>Employee response</strong><p style={{whiteSpace:'pre-wrap'}}>{n.employee_response}</p></div>}{n.status!=='closed' && <button className="small" onClick={()=>void closeNte(n.id)}>Close notice</button>}</article>)}
    {!items.length && !error && <p className="muted">No NTEs have been issued.</p>}
  </>
}