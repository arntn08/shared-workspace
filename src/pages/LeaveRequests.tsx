import { FormEvent, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

type LeaveRequest = {
  id:string; employee_id:string; employee_name:string; team_name:string|null; leave_type:string
  start_date:string; end_date:string; reason:string; attachment_path:string; attachment_name:string
  attachment_type:string; status:'pending'|'approved'|'rejected'; hr_comment:string|null
  created_at:string; profiles?:{full_name:string|null;email:string}
}
const allowedTypes = ['application/pdf','image/jpeg','image/png','image/webp']
const maxBytes = 10 * 1024 * 1024
const dateLabel = (value:string) => new Date(value+'T00:00:00').toLocaleDateString('en-PH',{month:'short',day:'numeric',year:'numeric'})
const safeFileName = (name:string) => name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g,'_').slice(-100) || 'signed-leave-form'

export default function LeaveRequests() {
  const {profile} = useAuth()
  const isHr = profile?.role === 'hr'
  const [items,setItems] = useState<LeaveRequest[]>([])
  const [leaveType,setLeaveType] = useState('Vacation Leave')
  const [start,setStart] = useState('')
  const [end,setEnd] = useState('')
  const [reason,setReason] = useState('')
  const [attachment,setAttachment] = useState<File|null>(null)
  const [comments,setComments] = useState<Record<string,string>>({})
  const [busy,setBusy] = useState('')
  const [error,setError] = useState('')
  const [message,setMessage] = useState('')

  async function load() {
    if (!profile) return
    setError('')
    const query = supabase.from('employee_leave_requests')
      .select('id,employee_id,employee_name,team_name,leave_type,start_date,end_date,reason,attachment_path,attachment_name,attachment_type,status,hr_comment,created_at,profiles:employee_id(full_name,email)')
      .order('created_at',{ascending:false})
    const {data,error:err} = isHr ? await query : await query.eq('employee_id',profile.id)
    if(err) setError(err.message+' — make sure the leave-request migration has been run in Supabase.')
    else setItems((data??[]) as unknown as LeaveRequest[])
  }
  useEffect(()=>{void load()},[profile?.id,profile?.role])

  async function submit(e:FormEvent) {
    e.preventDefault()
    if(!profile) return
    if(!attachment){setError('Attach a photo or scan of the signed physical leave form before submitting.');return}
    if(!allowedTypes.includes(attachment.type)){setError('Use a PDF, JPG, PNG, or WebP file.');return}
    if(attachment.size>maxBytes){setError('The physical leave form must be 10 MB or smaller.');return}
    if(!start||!end||end<start){setError('Choose a valid leave date range.');return}
    setBusy('submit');setError('');setMessage('')
    const id=crypto.randomUUID()
    const path='leave/'+id+'/'+Date.now()+'-'+safeFileName(attachment.name)
    const {error:insertError}=await supabase.from('employee_leave_requests').insert({
      id,employee_id:profile.id,employee_name:profile.full_name||profile.email,
      team_name:profile.teams?.join(', ')||null,leave_type:leaveType,start_date:start,end_date:end,
      reason:reason.trim(),attachment_path:path,attachment_name:attachment.name,attachment_type:attachment.type
    })
    if(insertError){setError(insertError.message);setBusy('');return}
    const {error:uploadError}=await supabase.storage.from('leave-attachments').upload(path,attachment,{contentType:attachment.type,upsert:false})
    if(uploadError){
      await supabase.from('employee_leave_requests').delete().eq('id',id).eq('employee_id',profile.id)
      setError('The request could not be submitted because the signed form upload failed: '+uploadError.message)
      setBusy('');return
    }
    setStart('');setEnd('');setReason('');setAttachment(null)
    const input=document.getElementById('leave-attachment') as HTMLInputElement|null
    if(input)input.value=''
    setMessage('Leave request submitted with the signed physical form. HR will review it.')
    await load();setBusy('')
  }

  async function openAttachment(item:LeaveRequest) {
    const {data,error:err}=await supabase.storage.from('leave-attachments').createSignedUrl(item.attachment_path,60)
    if(err||!data?.signedUrl){setError(err?.message||'Could not open the attached form.');return}
    window.open(data.signedUrl,'_blank','noopener,noreferrer')
  }

  async function review(item:LeaveRequest,status:'approved'|'rejected') {
    if(!isHr||!profile)return
    setBusy(item.id);setError('');setMessage('')
    const {error:err}=await supabase.from('employee_leave_requests').update({
      status,hr_comment:comments[item.id]?.trim()||null,reviewed_by:profile.id,reviewed_at:new Date().toISOString()
    }).eq('id',item.id).eq('status','pending')
    if(err)setError(err.message)
    else {setMessage('Request '+status+'.');await load()}
    setBusy('')
  }

  const counts={pending:items.filter(x=>x.status==='pending').length,approved:items.filter(x=>x.status==='approved').length,rejected:items.filter(x=>x.status==='rejected').length}
  return <>
    <div className="page-head"><div><h1>{isHr?'Leave requests':'Leave application'}</h1><p className="muted" style={{margin:0}}>{isHr?'Review employee leave applications and their signed physical forms.':'Submit your leave request with a photo or scan of the signed physical leave form.'}</p></div><button className="small" onClick={()=>void load()}>Refresh</button></div>
    {error&&<p className="error">{error}</p>}{message&&<p className="notice">{message}</p>}
    {isHr ? <>
      <div className="grid cols-3" style={{marginBottom:'1rem'}}>
        <section className="card"><div className="muted">Pending</div><h2>{counts.pending}</h2></section>
        <section className="card"><div className="muted">Approved</div><h2>{counts.approved}</h2></section>
        <section className="card"><div className="muted">Rejected</div><h2>{counts.rejected}</h2></section>
      </div>
    </> : <section className="card" style={{marginBottom:'1rem'}}>
      <h2 style={{marginTop:0}}>New leave request</h2>
      <form className="stack" onSubmit={e=>void submit(e)}>
        <label>Employee<input value={profile?.full_name||profile?.email||''} readOnly /></label>
        <label>Team<input value={profile?.teams?.join(', ')||'Not assigned'} readOnly /></label>
        <label>Leave type<select value={leaveType} onChange={e=>setLeaveType(e.target.value)}><option>Vacation Leave</option><option>Sick Leave</option><option>Emergency Leave</option><option>Other</option></select></label>
        <div className="row" style={{gap:'.75rem',flexWrap:'wrap'}}>
          <label style={{flex:1,minWidth:'180px'}}>Start date<input type="date" value={start} onChange={e=>setStart(e.target.value)} required /></label>
          <label style={{flex:1,minWidth:'180px'}}>End date<input type="date" value={end} min={start||undefined} onChange={e=>setEnd(e.target.value)} required /></label>
        </div>
        <label>Reason<textarea rows={4} value={reason} onChange={e=>setReason(e.target.value)} required maxLength={2000} placeholder="Enter the reason for your leave request."/></label>
        <label>Signed physical leave form <span className="muted">(required · PDF/JPG/PNG/WebP · max 10 MB)</span>
          <input id="leave-attachment" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" required onChange={e=>setAttachment(e.target.files?.[0]??null)}/>
        </label>
        {attachment&&<p className="muted">Attached: {attachment.name} · {(attachment.size/1024/1024).toFixed(2)} MB <button type="button" className="small" onClick={()=>{setAttachment(null);const input=document.getElementById('leave-attachment') as HTMLInputElement|null;if(input)input.value=''}}>Remove</button></p>}
        <div><button className="primary" disabled={busy==='submit'||!attachment}>{busy==='submit'?'Submitting…':'Submit leave request'}</button></div>
        <p className="muted" style={{margin:0}}>Your request will remain pending until HR reviews it. Only HR can approve or reject.</p>
      </form>
    </section>}
    <div className="page-head"><div><h2>{isHr?'Submitted applications':'My leave requests'}</h2><p className="muted" style={{margin:0}}>{isHr?'Open the signed physical form before making a decision.':'Track the status of your leave applications.'}</p></div></div>
    {items.map(item=><article className="card" key={item.id} style={{marginBottom:'.75rem'}}>
      <div className="row between" style={{alignItems:'flex-start',gap:'1rem',flexWrap:'wrap'}}>
        <div><h3 style={{marginTop:0,marginBottom:'.35rem'}}>{item.leave_type}</h3><p className="muted" style={{margin:0}}>{isHr?(item.employee_name||item.profiles?.full_name||item.profiles?.email)+' · '+(item.team_name||'No team')+' · ':''}{dateLabel(item.start_date)} – {dateLabel(item.end_date)}</p></div>
        <span className="badge">{item.status}</span>
      </div>
      <p style={{whiteSpace:'pre-wrap'}}>{item.reason}</p>
      <p><button className="small" onClick={()=>void openAttachment(item)}>View signed physical form · {item.attachment_name}</button></p>
      {item.hr_comment&&<div className="notice"><strong>HR comment</strong><p style={{whiteSpace:'pre-wrap',marginBottom:0}}>{item.hr_comment}</p></div>}
      {isHr&&item.status==='pending'&&<div className="stack" style={{marginTop:'.75rem'}}>
        <label>Decision comment <span className="muted">(optional)</span><textarea rows={2} value={comments[item.id]??''} onChange={e=>setComments(v=>({...v,[item.id]:e.target.value}))} placeholder="Add a note for the employee…"/></label>
        <div className="row" style={{gap:'.5rem',flexWrap:'wrap'}}>
          <button className="primary" disabled={busy===item.id} onClick={()=>void review(item,'approved')}>Approve</button>
          <button className="small" disabled={busy===item.id} onClick={()=>void review(item,'rejected')}>Reject</button>
        </div>
      </div>}
      {item.status!=='pending'&&<p className="muted">Reviewed {item.status}.</p>}
    </article>)}
    {!items.length&&!error&&<section className="card"><h2>{isHr?'No leave applications yet':'No leave requests yet'}</h2><p className="muted">{isHr?'New employee submissions will appear here.':'Your submitted leave applications will appear here.'}</p></section>}
  </>
}
