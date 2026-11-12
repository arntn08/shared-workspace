import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, PointerEvent } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { ageLabel, cacheGet, cacheSet, clearCache } from '../lib/offline'
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
  const [flipped, setFlipped] = useState(false)
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

      <div className="profile-layout">
        <section className="profile-id-panel" aria-label="Employee identification card">
          <div className="id-lanyard" aria-hidden="true"><span /><span /></div>
          <div className="idscene">
            <div className="id-sway">
              <button
                type="button"
                className={`idcard ${flipped ? 'is-flipped' : ''}`}
                ref={card as unknown as React.RefObject<HTMLDivElement>}
                onClick={() => setFlipped((v) => !v)}
                onPointerMove={move}
                onPointerLeave={leave}
                onPointerCancel={leave}
                aria-label={flipped ? 'Show front of employee ID' : 'Flip employee ID to show details'}
              >
                <span className="id-card-inner">
                  <span className="id-face id-front">
                    <span className="id-clip" aria-hidden="true"><i /></span>
                    <span className="id-front-title">AHBA Development · Training<br />&amp; QA</span>
                    <span className="id-eyebrow">EMPLOYEE ID</span>
                    <span className="id-avatar">
                      {photo ? <img src={photo} alt="" /> : <span className="id-initials">{name.split(/\\s+/).map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span>}
                    </span>
                    <strong className="id-person-name">{name}</strong>
                    <span className="id-role">{ROLE_LABEL[profile.role] || 'Employee'}</span>
                    <span className="id-company">AHBA Development</span>
                    <span className="id-front-footer"><span>ID {profile.employee_id || 'not yet assigned'}</span><b>Regular</b></span>
                  </span>
                  <span className="id-face id-back">
                    <strong>Employee details</strong>
                    <span className="id-back-row"><small>Full name</small><b>{name}</b></span>
                    <span className="id-back-row"><small>Team code</small><b>{codes.join(', ') || 'Not matched yet'}</b></span>
                    <span className="id-back-row"><small>JO MOB</small><b>{mobs.join(', ') || '—'}</b></span>
                    <span className="id-back-row"><small>Email</small><b>{profile.email || '—'}</b></span>
                    <span className="id-back-row"><small>Member since</small><b>{since}</b></span>
                    <span className="id-back-row"><small>Account reference</small><b>{ref}</b></span>
                    <span className="id-back-hint">Tap to return to the front</span>
                  </span>
                </span>
              </button>
            </div>
          </div>
          <p className="id-hint">Tap or click the card to flip it.</p>
        </section>

        <section className="profile-side-cards" aria-label="Profile settings and device">
          <div className="card profile-actions">
            <div className="profile-card-heading"><span className="profile-card-icon">✦</span><div><h2>Profile photo</h2><p>Keep your employee ID up to date.</p></div></div>
            <div className="row">
              <label className="btn small" style={{ margin: 0, cursor: 'pointer' }}>
                {busy ? 'Working…' : photo ? 'Change photo' : 'Add photo'}
                <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={onPhoto} disabled={busy} />
              </label>
              {photo && <button className="small" onClick={removePhoto} disabled={busy}>Remove photo</button>}
              <Link className="btn small" to="/settings">Settings</Link>
            </div>
            <p className="muted profile-card-note">Photos are private to you and the owner or editors, and are resized on your device before upload.</p>
          </div>

          <div className="card profile-actions">
            <div className="profile-card-heading"><span className="profile-card-icon">⌁</span><div><h2>On this device</h2><p>Your offline workspace</p></div></div>
            <p className="muted profile-card-note">Your schedule, files, tally and notifications are saved here so you can read them offline. On a shared phone, clear them before handing it over.</p>
            {savedAt && <p className="muted profile-card-note">Last saved: {ageLabel(savedAt)} ago.</p>}
            <div className="row">
              <button className="small" onClick={wipe}>Clear saved data</button>
              <button className="small" onClick={signOut}>Sign out</button>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}
