import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, PointerEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { ageLabel, cacheGet, cacheSet, clearCache } from '../lib/offline'
import { initialsOf } from '../components/Nav'
import './profile.css'

interface RosterRow {
  team: string
  code: string | null
  jo_mob: string | null
}
const ROLE_LABEL: Record<string, string> = { owner: 'Owner', editor: 'Editor', employee: 'Employee' }

async function squareWebp(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error('Could not read that image.'))
      i.src = url
    })
    const size = 512
    const s = Math.min(img.width, img.height)
    const c = document.createElement('canvas')
    c.width = size
    c.height = size
    const ctx = c.getContext('2d')
    if (!ctx) throw new Error('Image processing is not available.')
    ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size)
    return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('Could not process the image.'))), 'image/webp', 0.85))
  } finally {
    URL.revokeObjectURL(url)
  }
}
const toDataUrl = (b: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(new Error('read failed'))
    r.readAsDataURL(b)
  })

export default function Profile() {
  const { profile, signOut } = useAuth()
  const uid = profile?.id as string | undefined
  const card = useRef<HTMLDivElement>(null)
  const [roster, setRoster] = useState<RosterRow[]>([])
  const [photo, setPhoto] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ text: string; err: boolean } | null>(null)
  const path = `${uid}/avatar`

  useEffect(() => {
    if (!uid) return
    ;(async () => {
      const r = await supabase.rpc('my_roster')
      if (r.error) {
        const c = cacheGet<RosterRow[]>(uid, 'roster')
        if (c) {
          setRoster(c.data)
          setSavedAt(c.at)
        }
      } else {
        setRoster((r.data ?? []) as RosterRow[])
        cacheSet(uid, 'roster', r.data ?? [])
      }
      const s = await supabase.storage.from('avatars').createSignedUrl(path, 3600)
      if (!s.error && s.data?.signedUrl) {
        setPhoto(s.data.signedUrl)
        if (!cacheGet<string>(uid, 'photo')?.data) {
          try {
            const blob = await (await fetch(s.data.signedUrl)).blob()
            cacheSet(uid, 'photo', await toDataUrl(blob))
          } catch {
            /* offline copy of the photo is optional */
          }
        }
      } else {
        setPhoto(cacheGet<string>(uid, 'photo')?.data || null)
      }
    })()
  }, [uid])

  function move(e: PointerEvent<HTMLDivElement>) {
    const el = card.current
    if (!el) return
    const r = e.currentTarget.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width
    const y = (e.clientY - r.top) / r.height
    el.style.setProperty('--ry', `${(x - 0.5) * 16}deg`)
    el.style.setProperty('--rx', `${-(y - 0.5) * 12}deg`)
    el.style.setProperty('--px', `${x * 100}%`)
    el.style.setProperty('--py', `${y * 100}%`)
  }
  function leave() {
    const el = card.current
    if (!el) return
    el.style.setProperty('--rx', '0deg')
    el.style.setProperty('--ry', '0deg')
  }

  async function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !uid) return
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return setMsg({ text: 'Use a PNG, JPG or WebP photo.', err: true })
    if (file.size > 8 * 1024 * 1024) return setMsg({ text: 'Choose a photo under 8 MB.', err: true })
    setBusy(true)
    setMsg(null)
    try {
      const blob = await squareWebp(file)
      const up = await supabase.storage.from('avatars').upload(path, blob, { upsert: true, contentType: blob.type || 'image/webp' })
      if (up.error) throw new Error('Could not upload the photo.')
      const url = await toDataUrl(blob)
      cacheSet(uid, 'photo', url)
      setPhoto(url)
      setMsg({ text: 'Photo updated.', err: false })
    } catch (err) {
      setMsg({ text: err instanceof Error ? err.message : 'Could not update the photo.', err: true })
    }
    setBusy(false)
  }

  async function removePhoto() {
    if (!uid) return
    setBusy(true)
    const { error } = await supabase.storage.from('avatars').remove([path])
    setBusy(false)
    if (error) return setMsg({ text: 'Could not remove the photo.', err: true })
    cacheSet(uid, 'photo', '')
    setPhoto(null)
    setMsg({ text: 'Photo removed.', err: false })
  }

  function wipe() {
    if (!uid || !confirm('Remove the saved copies of your schedule, files and notifications from this device?')) return
    clearCache(uid)
    setSavedAt(null)
    setMsg({ text: 'Saved data removed from this device.', err: false })
  }

  if (!profile) return null
  const codes = [...new Set(roster.map((r) => r.code).filter(Boolean))] as string[]
  const mobs = [...new Set(roster.map((r) => r.jo_mob).filter(Boolean))] as string[]
  const ref = profile.id.slice(0, 8).toUpperCase().replace(/^(.{4})/, '$1-')
  const since = profile.created_at ? new Date(profile.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : '—'
  const name = profile.full_name || profile.email

  return (
    <>
      <div className="page-head"><h1>Profile</h1></div>
      {savedAt && <div className="notice">Offline: showing the details saved {ageLabel(savedAt)}.</div>}
      {msg && <div className={`notice${msg.err ? ' error' : ''}`}>{msg.text}</div>}

      <div className="idscene">
        <div className="id-sway">
          <div className="idcard" ref={card} onPointerMove={move} onPointerLeave={leave} onPointerCancel={leave}>
            <div className="id-sheen" />
            <div className="id-orgbar"><span className="id-brand">A</span><strong>AHBA DEVELOPMENT</strong><span className="id-status">ACTIVE</span></div>
            <div className="portrait-card">
              <div className="id-avatar">
                {photo ? <img src={photo} alt={`${name} profile photo`} /> : (
                  <span className="profile-silhouette" aria-label={`Default profile icon for ${name}`}>
                    <svg viewBox="0 0 160 190" role="img" aria-hidden="true">
                      <defs>
                        <linearGradient id="profileGlass" x1="0" y1="0" x2="1" y2="1">
                          <stop offset="0%" stopColor="#ffffff" />
                          <stop offset="100%" stopColor="#e8edf4" />
                        </linearGradient>
                        <linearGradient id="profileBlue" x1="0" y1="0" x2="1" y2="1">
                          <stop offset="0%" stopColor="#a9b9ff" />
                          <stop offset="100%" stopColor="#596fd4" />
                        </linearGradient>
                      </defs>
                      <rect x="3" y="3" width="154" height="184" rx="22" fill="url(#profileGlass)" />
                      <circle cx="80" cy="21" r="6" fill="#20242d" />
                      <circle cx="80" cy="60" r="24" fill="#7f8ac0" opacity=".2" />
                      <circle cx="80" cy="57" r="22" fill="url(#profileBlue)" />
                      <path d="M38 119c2-25 20-39 42-39s40 14 42 39v5H38z" fill="url(#profileBlue)" />
                      <rect x="46" y="135" width="68" height="12" rx="6" fill="url(#profileBlue)" />
                      <rect x="25" y="154" width="110" height="11" rx="6" fill="url(#profileBlue)" />
                      <rect x="25" y="171" width="70" height="9" rx="5" fill="url(#profileBlue)" />
                    </svg>
                  </span>
                )}
              </div>
            </div>
          <div className="portrait-name">
            <span>Name</span>
            <strong>{name}</strong>
          </div>
                <div className="profile-details">
        <h2>Employee details</h2>
        <dl className="profile-detail-grid">
          <div><dt>Full name</dt><dd>{name}</dd></div>
          <div><dt>Role</dt><dd>{ROLE_LABEL[profile.role] || 'Employee'}</dd></div>
          <div><dt>Team code</dt><dd>{codes.join(', ') || 'Not matched yet'}</dd></div>
          <div><dt>JO MOB</dt><dd>{mobs.join(', ') || '—'}</dd></div>
          <div><dt>Email</dt><dd>{profile.email || '—'}</dd></div>
          <div><dt>Member since</dt><dd>{since}</dd></div>
          <div><dt>Account reference</dt><dd>{ref}</dd></div>
        </dl>
      </div>
          <div className="id-footer"><span>Account ref {ref}</span><strong>SHARED WORKSPACE</strong></div>
        </div>
      </div>
      <div className="card profile-actions">
        <h2>Your card</h2>
        <div className="row">
          <label className="btn small" style={{ margin: 0, cursor: 'pointer' }}>
            {busy ? 'Working…' : photo ? 'Change photo' : 'Add photo'}
            <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onPhoto} disabled={busy} />
          </label>
          {photo && <button className="small" onClick={removePhoto} disabled={busy}>Remove photo</button>}
          <Link className="btn small" to="/settings">Settings</Link>
        </div>
        <p className="muted" style={{ fontSize: '0.82rem', marginBottom: 0 }}>
          Photos are private to you and the owner or editors, and are resized on your device before upload.
        </p>
      </div>

      <div className="card profile-actions">
        <h2>On this device</h2>
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          Your schedule, files, tally and notifications are saved here so you can read them offline. On a shared phone, clear them before handing it over.
        </p>
        <div className="row">
          <button className="small" onClick={wipe}>Clear saved data</button>
          <button className="small" onClick={signOut}>Sign out</button>
        </div>
      </div>
    </>
  )
}
