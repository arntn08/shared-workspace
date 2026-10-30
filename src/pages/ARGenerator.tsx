import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createWorker } from 'tesseract.js'
import { jsPDF } from 'jspdf'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import './ar-generator.css'

type ARDraft = {
  id: string
  sourceName: string
  sourcePreview: string
  transactionType: string
  joNo: string
  joDate: string
  accountNo: string
  subscriberName: string
  address: string
  packageName: string
  napCode: string
  serialNo: string
  divisionCode: string
  companyCode: string
  receiptDate: string
  receiptNo: string
  saNo: string
  businessStyle: string
  tin: string
  amount: string
  amountWords: string
  paymentType: 'FULL' | 'PARTIAL'
  paymentDescription: string
  bankCheckNo: string
  vatable: string
  vatAmount: string
  vatExempt: string
  totalPayable: string
  ocrText: string
  status: 'draft' | 'saved'
}

type SavedAR = { id: string; jo_no: string | null; receipt_no: string | null; subscriber_name: string; amount: number; payment_type: string; created_at: string }

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' })
const blankDraft = (): ARDraft => ({
  id: crypto.randomUUID(), sourceName: '', sourcePreview: '', transactionType: '', joNo: '', joDate: '',
  accountNo: '', subscriberName: '', address: '', packageName: '', napCode: '',
  serialNo: '', divisionCode: '', companyCode: '', receiptDate: today(), receiptNo: '',
  saNo: '', businessStyle: '', tin: '', amount: '', amountWords: '', paymentType: 'FULL',
  paymentDescription: '', bankCheckNo: '', vatable: '', vatAmount: '', vatExempt: '',
  totalPayable: '', ocrText: '', status: 'draft'
})

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

// Labels that can appear on the JO reassignment screen. Keeping this list
// centralized prevents a blank field from consuming the next field's label.
const JO_LABELS = [
  'Transaction Type', 'Job Order No', 'Job Order Number', 'JO No', 'JO Date',
  'Job Order Date', 'Account No', 'Account Number', 'Subscriber Name',
  'Complete Address', 'Address', 'Package Name', 'Package', 'NAP Code',
  'Serial No', 'Serial Number', 'Division Code', 'Company Code'
]

function extractJobOrder(text: string, fileName: string): Partial<ARDraft> {
  const lines = text.split(/\r?\n/).map(clean).filter(Boolean)
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const isLabel = (s: string) => {
    const value = normalize(s)
    return JO_LABELS.some(label => value === normalize(label) || value.startsWith(normalize(label) + ' '))
  }

  const byLabel = (labels: string[]) => {
    const wanted = labels.map(normalize)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const normalized = normalize(line)
      const label = labels.find(candidate => normalized === normalize(candidate) || normalized.startsWith(normalize(candidate) + ' '))
      if (!label || !wanted.includes(normalize(label))) continue
      const tail = clean(line.slice(line.toLowerCase().indexOf(label.toLowerCase()) + label.length).replace(/^\s*[:：-]?\s*/, ''))
      if (tail && normalize(tail) !== normalize(label)) return tail
      const next = lines[i + 1] || ''
      if (next && !isLabel(next)) return next
    }
    return ''
  }

  const findPattern = (pattern: RegExp) => {
    const match = text.match(pattern)
    return match ? clean(match[1] || match[0]) : ''
  }

  // OCR sometimes drops a field label or merges it with a neighboring column.
  // Use conservative shape-based fallbacks for names and Philippine addresses.
  const nameFallback = lines.find(line =>
    /^[A-Z][A-Z .,'-]{5,}$/.test(line) &&
    line.includes(',') &&
    !/^(TRANSACTION|PACKAGE|DIVISION|COMPANY|MAINLINE|REASSIGN|CREW)/i.test(line) &&
    !/\\b(?:APPLICATION|FIBER|SKY)\\b/i.test(line)
  ) || ''
  const addressFallback = lines
    .filter(line => /\\b(?:LOT|BLOCK|BLK|PUROK|PHASE|UNIT|ROOM|HOUSE|STREET|ST|BRGY|BARANGAY|QUEZON CITY|MANILA|CALOOCAN|PASIG|TAGUIG|MAKATI|MARIKINA|NAGKAISANG)\\b/i.test(line))
    .sort((a,b) => b.length-a.length)[0] || ''

  // Stable identifiers are safer to recognize by their visible format than
  // by OCR line order, especially when the form uses two columns.
  const joNo = findPattern(/\b(R\d{6,})\b/i) || byLabel(['Job Order No', 'Job Order Number', 'JO No'])
  const accountNo = findPattern(/(?:Account\s*(?:No\.?|Number)\s*[:：]?\s*)(\d{8,})/i) ||
    findPattern(/\b(\d{10,14})\b/) || byLabel(['Account No', 'Account Number'])
  const joDate = findPattern(/\b(20\d{2}-\d{2}-\d{2})(?:T[0-9:.]+Z?)?/i) ||
    byLabel(['JO Date', 'Job Order Date'])
  const transactionType = /MAINLINE\s+APPLICATION/i.test(text) ? 'MAINLINE APPLICATION' : byLabel(['Transaction Type'])
  const subscriberName = findPattern(/(?:Subscriber\s*Name\s*[:：]?\s*)([A-Z][A-Z ,.'-]{5,})/i) ||
    byLabel(['Subscriber Name'])
  const packageName = findPattern(/\b(SKY\s+FIBER\s+\d+)\b/i) || byLabel(['Package Name', 'Package'])
  const divisionCode = findPattern(/(?:Division\s*Code\s*[:：]?\s*)([A-Z0-9-]+)/i) ||
    findPattern(/\b(SKYNC)\b/i) || byLabel(['Division Code'])
  const companyCode = findPattern(/(?:Company\s*Code\s*[:：]?\s*)([A-Z0-9-]+)/i) ||
    findPattern(/\b(COMCL)\b/i) || byLabel(['Company Code'])

  const crewHeader = lines.findIndex(line => /REASSIGN\s+JO\s+TO\s+CREW/i.test(line))
  const crewCandidate = crewHeader >= 0
    ? (lines.slice(crewHeader + 1).find(line => /[A-Z]{2,}.*-.*[A-Z0-9]+/i.test(line)) || '')
    : (text.match(/\b([A-Z][A-Z .'-]+\s*-\s*[A-Z]{1,4}\d{2,})\b/)?.[1] || '')
  const businessStyle = crewCandidate ? 'CREW: ' + clean(crewCandidate) : ''

  // Do not infer NAP/serial from adjacent labels, and never infer money from
  // the package name (e.g. "SKY FIBER 999" is not an amount received).
  const napCode = byLabel(['NAP Code'])
  const serialNo = byLabel(['Serial No', 'Serial Number'])
  const address = byLabel(['Complete Address', 'Address']) || addressFallback

  return {
    sourceName: fileName,
    transactionType,
    joNo,
    joDate,
    accountNo,
    subscriberName: clean(subscriberName).replace(/^Subscriber\s*Name\s*/i, ''),
    address,
    packageName,
    napCode,
    serialNo,
    divisionCode,
    companyCode,
    paymentDescription: packageName || transactionType,
    businessStyle,
    amount: '',
    totalPayable: '',
    ocrText: text
  }
}

const peso = (v: string) => Number(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
function numberWords(value: string) {
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return ''
  const small = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen']
  const tens = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety']
  const under = (x: number): string => x < 20 ? small[x] : x < 100 ? tens[Math.floor(x/10)] + (x%10 ? '-' + small[x%10] : '') : small[Math.floor(x/100)] + ' hundred' + (x%100 ? ' ' + under(x%100) : '')
  const whole = Math.floor(n), cents = Math.round((n-whole)*100)
  const chunks: string[] = []
  let rest = whole
  for (const [size,label] of [[1000000,'million'],[1000,'thousand'],[1,'']] as [number,string][]) {
    const part = Math.floor(rest/size)
    if (part) chunks.push((part < 1000 ? under(part) : String(part)) + (label ? ' ' + label : ''))
    rest %= size
  }
  return (chunks.join(' ') || 'zero') + ' pesos' + (cents ? ' and ' + under(cents) + ' centavos' : ' only')
}

function drawReceipt(doc: jsPDF, d: ARDraft) {
  const W = 864, H = 576
  doc.setFillColor(255,255,255); doc.rect(0,0,W,H,'F')
  doc.setFillColor(17,23,19); doc.rect(10,10,W-20,88,'F')
  doc.setTextColor(255,255,255); doc.setFont('helvetica','bolditalic'); doc.setFontSize(22); doc.text('SKY',34,48)
  doc.setFont('helvetica','bold'); doc.setFontSize(20); doc.text('Cable Corporation',79,48)
  doc.setFontSize(8.5); doc.text('6th Floor ELJ Communication Center Bldg.',35,65)
  doc.text('Mother Ignacia St., Diliman, South Triangle, Quezon City',35,78)
  doc.text('VAT Reg. TIN: 000-443-507-00000',35,91)
  doc.setFillColor(16,22,18); doc.roundedRect(20,111,212,42,20,20,'F')
  doc.setTextColor(255,255,255); doc.setFontSize(16); doc.text('OFFICIAL RECEIPT',126,138,{align:'center'})
  doc.setTextColor(0,0,0); doc.setFont('helvetica','normal'); doc.setFontSize(24); doc.text('A',W-28,137,{align:'right'})
  const label=(s:string,x:number,y:number,size=11)=>{doc.setFont('helvetica','bold');doc.setFontSize(size);doc.text(s,x,y)}
  const line=(x:number,y:number,x2:number)=>doc.line(x,y,x2,y)
  const val=(s:string,x:number,y:number,max=400,size=10)=>{if(s){doc.setFont('helvetica','normal');doc.setFontSize(size);doc.text(s,x,y,{maxWidth:max})}}
  label('DATE',545,184,10.5); line(594,187,W-28); val(d.receiptDate,600,183,210)
  label('RECEIVED from',20,240); line(116,242,688); val(d.subscriberName,120,239,550,9.5)
  label('with',698,240)
  label('Address/TIN',20,286); line(98,288,430); val([d.address,d.tin].filter(Boolean).join(' / '),102,284,325,8.5)
  label('engaged in Business Style of',438,286,10); line(657,288,W-28); val(d.businessStyle,660,284,170,8.5)
  label('the sum of',20,326); line(86,328,W-28); val(d.amountWords || numberWords(d.amount),90,324,730,9.5)
  label('Pesos (P',20,367); line(74,369,384); val(d.amount ? peso(d.amount) : '',79,365,290)
  label(') as (' + d.paymentType + ') payment of',391,367,10); line(610,369,W-28); val(d.paymentDescription || d.packageName,614,365,210,9)
  label('SA No.',20,405); line(75,407,340); val(d.saNo,80,403,255)
  label('Account No.',355,405); line(430,407,W-28); val(d.accountNo,435,403,390)
  label('BANK/CHECK No.',20,492,9.5); line(20,520,225); val(d.bankCheckNo,25,516,195)
  const tx=236, ty=452, rh=19, c1=106, c2=115
  ;['VATable Receipt','VAT Amount','VATExempt','Total Amount Payable'].forEach((s,i)=>{const y=ty+i*rh;doc.rect(tx,y,c1+c2,rh);doc.line(tx+c1,y,tx+c1,y+rh);doc.setFont('helvetica','normal');doc.setFontSize(8);doc.text(s,tx+5,y+13)})
  val(d.vatable,tx+c1+5,ty+13,100,8); val(d.vatAmount,tx+c1+5,ty+32,100,8); val(d.vatExempt,tx+c1+5,ty+51,100,8); val(d.totalPayable || d.amount,tx+c1+5,ty+70,100,8)
  doc.setFont('helvetica','bold');doc.setFontSize(11);doc.text('SKY Cable Corporation',650,453,{align:'center'})
  label('By:',525,496,10); line(554,499,W-28); doc.setFont('helvetica','normal');doc.setFontSize(7.5);doc.text('Cashier/Authorized Representative',665,515,{align:'center'})
  doc.setFontSize(7);doc.text('3,500 books (50x3) SN 2100001 - 2275000',20,538)
  doc.text('BIR Authority to Print No. 126AU20210000006122',20,548)
  doc.text('Date of ATP: 12-14-2021    Expiry Date: 12-13-2026',20,558)
  doc.text('Printed By Horizon Printers',255,538);doc.text('SAT REG TIN 130-062-038-00000',255,548)
  doc.text('9 S. Laurel St., Addition Hills, Mandaluyong City',255,558)
  doc.text('BIR Accreditation No. 041MP20190000000004',255,568)
  doc.setFont('helvetica','bold');doc.setFontSize(7);doc.text('THIS OFFICIAL RECEIPT SHALL BE VALID FOR FIVE (5) YEARS FROM THE DATE OF ATP.',W/2,573,{align:'center'})
  if(d.receiptNo){doc.setFont('helvetica','bold');doc.setFontSize(17);doc.setTextColor(145,55,55);doc.text(d.receiptNo,760,548,{align:'right'})}
}

function makePdf(drafts: ARDraft[], fileName: string) {
  const doc = new jsPDF({ orientation:'landscape', unit:'pt', format:[864,576] })
  drafts.forEach((draft,index)=>{if(index)doc.addPage([864,576],'landscape');drawReceipt(doc,draft)})
  doc.save(fileName)
}

function Field({label,value,onChange,wide=false,type='text'}:{label:string;value:string;onChange:(v:string)=>void;wide?:boolean;type?:string}) {
  return <label className={wide?'ar-field wide':'ar-field'}><span>{label}</span><input type={type} value={value} onChange={e=>onChange(e.target.value)} /></label>
}

export default function ARGenerator() {
  const { profile } = useAuth()
  const [drafts,setDrafts] = useState<ARDraft[]>([])
  const [saved,setSaved] = useState<SavedAR[]>([])
  const [busy,setBusy] = useState(false)
  const [progress,setProgress] = useState('')
  const [error,setError] = useState('')
  const [tab,setTab] = useState<'create'|'history'>('create')
  const inputRef = useRef<HTMLInputElement>(null)
  const update = useCallback((id:string, patch:Partial<ARDraft>)=>setDrafts(prev=>prev.map(d=>d.id===id?{...d,...patch}:d)),[])
  const loadHistory = useCallback(async()=>{
    const {data,error}=await supabase.from('ar_records').select('id,jo_no,receipt_no,subscriber_name,amount,payment_type,created_at').order('created_at',{ascending:false}).limit(100)
    if(error){setError(error.message);return}
    setSaved((data||[]) as SavedAR[])
  },[])
  useEffect(()=>{loadHistory()},[loadHistory])
  const processFiles = async(files:FileList|null)=>{
    if(!files?.length)return
    setBusy(true);setError('')
    let worker: Awaited<ReturnType<typeof createWorker>>|null=null
    try{
      worker=await createWorker('eng')
      const added:ARDraft[]=[]
      for(let i=0;i<files.length;i++){
        const file=files[i];setProgress('Reading '+file.name+' ('+(i+1)+'/'+files.length+')')
        const {data}=await worker.recognize(file)
        const draft={...blankDraft(),...extractJobOrder(data.text,file.name),sourcePreview:URL.createObjectURL(file)}
        if(draft.packageName && !draft.amount) setProgress('Package found; amount needs manual entry.')
        added.push(draft)
      }
      setDrafts(prev=>[...prev,...added])
      setProgress('Extracted '+added.length+' screenshot(s). Review every field before saving.')
    }catch(e){setError(e instanceof Error?e.message:'Could not read the selected screenshots. You can still enter details manually.')}
    finally{if(worker)await worker.terminate();setBusy(false);if(inputRef.current)inputRef.current.value=''}
  }
  const saveDraft = async(d:ARDraft)=>{
    if(!d.subscriberName.trim()||!d.joNo.trim()||!d.accountNo.trim()){setError('Subscriber name, Job Order No. and Account No. are required.');return}
    const amount=Number(d.amount)
    if(!Number.isFinite(amount)||amount<=0){setError('Enter the actual amount received before saving this AR.');return}
    if(!d.receiptNo.trim()){setError('Enter the official receipt number from the authorized company receipt sequence.');return}
    const {data:duplicate}=await supabase.from('ar_records').select('id').eq('jo_no',d.joNo).limit(1)
    if(duplicate?.length){setError('This Job Order No. already has an AR record. Check History before creating another.');return}
    const payload={created_by:profile?.id,jo_no:d.joNo,jo_date:d.joDate||null,receipt_no:d.receiptNo,receipt_date:d.receiptDate,subscriber_name:d.subscriberName,address:d.address,account_no:d.accountNo,transaction_type:d.transactionType,package_name:d.packageName,payment_type:d.paymentType,amount,amount_words:d.amountWords||numberWords(d.amount),payment_description:d.paymentDescription||d.packageName,sa_no:d.saNo,business_style:d.businessStyle,tin:d.tin,bank_check_no:d.bankCheckNo,vatable:d.vatable?Number(d.vatable):null,vat_amount:d.vatAmount?Number(d.vatAmount):null,vat_exempt:d.vatExempt?Number(d.vatExempt):null,total_payable:d.totalPayable?Number(d.totalPayable):amount,ocr_text:d.ocrText}
    const {error}=await supabase.from('ar_records').insert(payload)
    if(error){setError(error.message);return}
    update(d.id,{status:'saved'});await loadHistory()
  }
  const exportOne=(d:ARDraft)=>makePdf([d],'AR-'+(d.receiptNo||d.joNo||'draft')+'.pdf')
  const exportAll=()=>{const selected=drafts.filter(d=>d.status==='saved');if(!selected.length){setError('Save at least one verified AR before exporting the batch.');return}makePdf(selected,'SKY-AR-Batch-'+today()+'.pdf')}
  const counts=useMemo(()=>({total:drafts.length,saved:drafts.filter(d=>d.status==='saved').length}),[drafts])

  return <div className="ar-page">
    <div className="ar-hero"><div><div className="ar-eyebrow">FINANCE • RECEIPT WORKFLOW</div><h1>AR Generator</h1><p>Turn Messenger job-order screenshots into verified acknowledgement receipt drafts.</p></div><div className="ar-hero-icon">₱</div></div>
    <div className="ar-tabs"><button className={tab==='create'?'active':''} onClick={()=>setTab('create')}>Create AR</button><button className={tab==='history'?'active':''} onClick={()=>{setTab('history');loadHistory()}}>AR History</button></div>
    {error&&<div className="ar-alert error">{error}</div>}
    {tab==='create'?<>
      <div className="ar-upload card">
        <div><h2>Import job-order screenshots</h2><p>Upload one or several Messenger screenshots. OCR reads the text locally in your browser; review all extracted details before saving.</p></div>
        <input ref={inputRef} type="file" accept="image/*" multiple onChange={e=>processFiles(e.target.files)} />
        <div className="ar-upload-actions"><button onClick={()=>inputRef.current?.click()} disabled={busy}>{busy?'Reading screenshots…':'＋ Upload screenshots'}</button><button className="secondary" onClick={()=>setDrafts(prev=>[...prev,blankDraft()])}>＋ Add manually</button></div>
        {progress&&<p className="ar-progress">{progress}</p>}
        <p className="ar-hint">OCR may misread names, account numbers or addresses. Confirm every field manually. Images are not uploaded to Supabase by this feature.</p>
      </div>
      <div className="ar-batch-head"><div><h2>AR drafts <span>{counts.total}</span></h2><p>{counts.saved} saved • {counts.total-counts.saved} awaiting review</p></div><button onClick={exportAll} disabled={!counts.saved}>Download combined PDF</button></div>
      {!drafts.length&&<div className="card ar-empty"><strong>No AR drafts yet</strong><p>Upload job-order screenshots or add an AR manually to begin.</p></div>}
      {drafts.map((d,index)=><section className="card ar-draft" key={d.id}>
        <div className="ar-draft-head"><div><span className="ar-draft-number">AR DRAFT {index+1}</span><h2>{d.subscriberName||'New subscriber'}</h2><p>{d.joNo||'No job order number'} {d.sourceName?' • '+d.sourceName:''}</p></div><span className={'ar-status '+d.status}>{d.status==='saved'?'Saved':'Needs review'}</span></div>
        {d.sourcePreview&&<details className="ar-source-preview">
          <summary>Preview uploaded screenshot</summary>
          <div className="ar-source-preview-body"><img src={d.sourcePreview} alt="Uploaded job order screenshot preview" /><p>Compare this original image with the extracted fields below. You can keep the image open while correcting the draft.</p></div>
        </details>}
        <div className="ar-fields">
          <Field label="Job Order No." value={d.joNo} onChange={v=>update(d.id,{joNo:v})}/>
          <Field label="JO Date" value={d.joDate} onChange={v=>update(d.id,{joDate:v})}/>
          <Field label="Subscriber Name" value={d.subscriberName} onChange={v=>update(d.id,{subscriberName:v})}/>
          <Field label="Account No." value={d.accountNo} onChange={v=>update(d.id,{accountNo:v})}/>
          <Field label="Complete Address" value={d.address} onChange={v=>update(d.id,{address:v})} wide/>
          <Field label="Transaction Type" value={d.transactionType} onChange={v=>update(d.id,{transactionType:v})}/>
          <Field label="Package Name" value={d.packageName} onChange={v=>update(d.id,{packageName:v})}/>
          <Field label="NAP Code" value={d.napCode} onChange={v=>update(d.id,{napCode:v})}/>
          <Field label="Serial No." value={d.serialNo} onChange={v=>update(d.id,{serialNo:v})}/>
          <Field label="Division Code" value={d.divisionCode} onChange={v=>update(d.id,{divisionCode:v})}/>
          <Field label="Company Code" value={d.companyCode} onChange={v=>update(d.id,{companyCode:v})}/>
          <Field label="Receipt Date" value={d.receiptDate} onChange={v=>update(d.id,{receiptDate:v})} type="date"/>
          <Field label="Official Receipt No. (manual)" value={d.receiptNo} onChange={v=>update(d.id,{receiptNo:v})}/>
          <Field label="SA No." value={d.saNo} onChange={v=>update(d.id,{saNo:v})}/>
          <Field label="Business Style" value={d.businessStyle} onChange={v=>update(d.id,{businessStyle:v})}/>
          <Field label="TIN" value={d.tin} onChange={v=>update(d.id,{tin:v})}/>
          <Field label="Amount received (₱)" value={d.amount} onChange={v=>update(d.id,{amount:v,totalPayable:v})} type="number"/>
          <Field label="Amount in words (optional)" value={d.amountWords} onChange={v=>update(d.id,{amountWords:v})} wide/>
          <label className="ar-field"><span>Payment type</span><select value={d.paymentType} onChange={e=>update(d.id,{paymentType:e.target.value as 'FULL'|'PARTIAL'})}><option value="FULL">Full payment</option><option value="PARTIAL">Partial payment</option></select></label>
          <Field label="Payment description" value={d.paymentDescription} onChange={v=>update(d.id,{paymentDescription:v})}/>
          <Field label="Bank / Check No." value={d.bankCheckNo} onChange={v=>update(d.id,{bankCheckNo:v})}/>
          <Field label="VATable Receipt" value={d.vatable} onChange={v=>update(d.id,{vatable:v})}/>
          <Field label="VAT Amount" value={d.vatAmount} onChange={v=>update(d.id,{vatAmount:v})}/>
          <Field label="VAT Exempt" value={d.vatExempt} onChange={v=>update(d.id,{vatExempt:v})}/>
          <Field label="Total Amount Payable" value={d.totalPayable} onChange={v=>update(d.id,{totalPayable:v})}/>
        </div>
        <div className="ar-template-note">Receipt output follows the supplied SKY AR layout. Verify VAT values, printed authorization details and current company-approved receipt format with Accounting before official use.</div>
        <div className="ar-draft-actions"><button className="secondary" onClick={()=>exportOne(d)}>Download this AR PDF</button><button onClick={()=>saveDraft(d)} disabled={d.status==='saved'}>{d.status==='saved'?'Saved to history':'Verify & save AR'}</button><button className="danger" onClick={()=>setDrafts(prev=>prev.filter(x=>x.id!==d.id))}>Remove</button></div>
      </section>)}
      {counts.saved>0&&<div className="ar-export-footer"><div><strong>{counts.saved} saved receipt(s)</strong><p>Combined PDF contains one AR per page.</p></div><button onClick={exportAll}>Download combined PDF</button></div>}
    </>:<section className="card"><div className="ar-batch-head"><div><h2>Recent AR records</h2><p>Latest 100 records available to your account.</p></div><button className="secondary" onClick={loadHistory}>Refresh</button></div>{saved.length?<div className="ar-history-wrap"><table><thead><tr><th>Date</th><th>Receipt No.</th><th>Job Order</th><th>Subscriber</th><th>Payment</th><th>Amount</th></tr></thead><tbody>{saved.map(row=><tr key={row.id}><td>{new Date(row.created_at).toLocaleDateString('en-PH')}</td><td>{row.receipt_no||'—'}</td><td>{row.jo_no||'—'}</td><td>{row.subscriber_name}</td><td>{row.payment_type}</td><td>₱{peso(String(row.amount))}</td></tr>)}</tbody></table></div>:<p className="muted">No AR records found yet.</p>}</section>}
  </div>
}
