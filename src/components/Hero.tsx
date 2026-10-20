import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, PointerEvent } from 'react'
import { supabase } from '../lib/supabase'
import './hero.css'

const LAYERS = [0, 1, 2, 3, 4, 5, 6]

export default function Hero({ name, subtitle, canUpload }: { name: string; subtitle: string; canUpload: boolean }) {
  const logoRef = useRef<HTMLDivElement>(null)
  const [logo, setLogo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function loadLogo() {
    const { data } = await supabase.storage
      .from('branding')
      .list('', { limit: 20, sortBy: { column: 'created_at', order: 'desc' } })
    const f = (data ?? []).find((x) => x.name && !x.name.startsWith('.'))
    setLogo(f ? supabase.storage.from('branding').getPublicUrl(f.name).data.publicUrl : null)
  }
  useEffect(() => {
    loadLogo()
  }, [])

  function move(e: PointerEvent<HTMLDivElement>) {
    const el = logoRef.current
    if (!el) return
    const r = e.currentTarget.getBoundingClientRect()
    el.style.setProperty('--ry', `${((e.clientX - r.left) / r.width - 0.5) * 50}deg`)
    el.style.setProperty('--rx', `${-((e.clientY - r.top) / r.height - 0.5) * 30}deg`)
  }
  function leave() {
    const el = logoRef.current
    if (!el) return
    el.style.setProperty('--rx', '0deg')
    el.style.setProperty('--ry', '0deg')
  }

  async function upload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return setErr('Use a PNG, JPG or WebP image.')
    if (file.size > 2 * 1024 * 1024) return setErr('Keep the logo under 2 MB.')
    setBusy(true)
    setErr('')
    const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
    const fname = `logo-${Date.now()}.${ext}`
    const { error } = await supabase.storage.from('branding').upload(fname, file, { contentType: file.type })
    if (error) {
      setErr(error.message)
      setBusy(false)
      return
    }
    const { data } = await supabase.storage.from('branding').list('')
    const old = (data ?? []).map((x) => x.name).filter((n) => n !== fname && !n.startsWith('.'))
    if (old.length) await supabase.storage.from('branding').remove(old)
    await loadLogo()
    setBusy(false)
  }

  return (
    <div className="hero3d rise" onPointerMove={move} onPointerLeave={leave} onPointerCancel={leave}>
      <div className="topo">
        <div className="topo-plane">
          <i /><i /><i /><i /><i /><i /><i />
        </div>
      </div>

      <div className="hero3d-copy">
        <h1>Hi, {name} 👋</h1>
        <p className="muted">{subtitle}</p>
        {canUpload && (
          <div className="row" style={{ marginTop: '1rem' }}>
            <label className="btn small logo-upload">
              {busy ? 'Uploading…' : logo ? 'Change logo' : 'Upload your logo'}
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} disabled={busy} hidden />
            </label>
            {err && <span className="error" style={{ fontSize: '0.85rem' }}>{err}</span>}
          </div>
        )}
      </div>

      <div className="hero3d-stage">
        <div className="logo3d" ref={logoRef}>
          <div className="logo3d-sway">
            {LAYERS.map((i) => {
              const style = {
                transform: `translateZ(${-i * 6}px)`,
                opacity: i === 0 ? 1 : 0.5,
                filter: i === 0 ? undefined : 'brightness(0.55)'
              }
              return logo ? (
                <img key={i} className="logo3d-layer" src={logo} alt={i === 0 ? 'Company logo' : ''} style={style} />
              ) : (
                <div key={i} className="logo3d-layer logo-fallback" style={style}>W</div>
              )
            })}
          </div>
          <div className="logo-shadow" />
        </div>
      </div>
    </div>
  )
}
