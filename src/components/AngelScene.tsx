import { useEffect, useRef } from 'react'
import type { PointerEvent } from 'react'
import { defaultPrefs } from '../lib/prefs'
import { Icon } from './Nav'
import './angel.css'

const BASE = import.meta.env.BASE_URL as string
const ART = { light: `${BASE}hero/angel-light.webp`, dark: `${BASE}hero/angel-dark.webp` }

interface Mote {
  x: number
  y: number
  r: number
  v: number
  a: number
  ph: number
}
const make = (fromBottom: boolean): Mote => ({
  x: Math.random(),
  y: fromBottom ? 1.04 : Math.random(),
  r: 0.6 + Math.random() * 1.7,
  v: 0.02 + Math.random() * 0.05,
  a: 0.25 + Math.random() * 0.5,
  ph: Math.random() * 6.28
})

function Plate({ theme }: { theme: 'light' | 'dark' }) {
  const bg = { backgroundImage: `url(${ART[theme]})` }
  return (
    <div className={`plate ${theme}`}>
      <img className="plate-img" src={ART[theme]} alt="" draggable={false} decoding="async" />
      <div className="fx wing wing-l" style={bg} />
      <div className="fx wing wing-r" style={bg} />
      <div className="fx silk silk-body" style={bg} />
      <div className="fx silk silk-floor" style={bg} />
    </div>
  )
}

export default function AngelScene() {
  const stage = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const target = useRef({ x: 0, y: 0 })

  useEffect(() => {
    const st = stage.current
    const cv = canvas.current
    if (!st || !cv) return
    const ctx = cv.getContext('2d')
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) return
    const small = window.matchMedia('(max-width: 760px)').matches
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    const count = small ? 22 : 46
    const motes = Array.from({ length: count }, () => make(false))
    const cur = { x: 0, y: 0 }
    let w = 1
    let h = 1
    let raf = 0
    let last = performance.now()

    const size = () => {
      const r = st.getBoundingClientRect()
      w = Math.max(1, r.width)
      h = Math.max(1, r.height)
      cv.width = Math.round(w * dpr)
      cv.height = Math.round(h * dpr)
      ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    size()
    const ro = new ResizeObserver(size)
    ro.observe(st)

    const frame = (t: number) => {
      raf = requestAnimationFrame(frame)
      if (document.hidden) return
      const dt = Math.min(0.05, (t - last) / 1000)
      last = t
      cur.x += (target.current.x - cur.x) * 0.06
      cur.y += (target.current.y - cur.y) * 0.06
      st.style.setProperty('--mx', cur.x.toFixed(3))
      st.style.setProperty('--my', cur.y.toFixed(3))
      if (!ctx) return
      const dark = document.documentElement.dataset.theme !== 'light'
      ctx.clearRect(0, 0, w, h)
      ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over'
      for (let i = 0; i < motes.length; i++) {
        const m = motes[i]
        m.y -= m.v * dt
        m.x += Math.sin(t / 2600 + m.ph) * 0.01 * dt
        if (m.y < -0.04) {
          motes[i] = make(true)
          continue
        }
        const tw = 0.6 + 0.4 * Math.sin(t / 900 + m.ph)
        ctx.fillStyle = dark
          ? `rgba(255,214,140,${(m.a * tw).toFixed(3)})`
          : `rgba(206,160,80,${(m.a * tw * 0.85).toFixed(3)})`
        ctx.beginPath()
        ctx.arc(m.x * w, m.y * h, m.r, 0, 6.2832)
        ctx.fill()
      }
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])

  function move(e: PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    target.current = { x: (e.clientX - r.left) / r.width - 0.5, y: (e.clientY - r.top) / r.height - 0.5 }
  }
  function leave() {
    target.current = { x: 0, y: 0 }
  }

  function toggleTheme() {
    const root = document.documentElement
    const next = root.dataset.theme === 'light' ? 'dark' : 'light'
    const st = stage.current
    st?.classList.remove('flash')
    void st?.offsetWidth
    st?.classList.add('flash')
    window.setTimeout(() => st?.classList.remove('flash'), 1300)
    root.dataset.theme = next
    defaultPrefs.theme = next
    try {
      localStorage.setItem('ws-theme', next)
    } catch {
      /* storage unavailable: theme still applies for this visit */
    }
  }

  return (
    <div className="angel-stage" ref={stage} onPointerMove={move} onPointerLeave={leave} onPointerCancel={leave}>
      <div className="sky sky-light" aria-hidden="true" />
      <div className="sky sky-dark" aria-hidden="true" />

      <div className="layer l-angel" aria-hidden="true">
        <div className="angel-box">
          <div className="angel-float">
            <div className="feather">
              <Plate theme="light" />
              <Plate theme="dark" />
            </div>
            <div className="rays" />
            <div className="halo" />
          </div>
        </div>
      </div>

      <canvas className="motes" ref={canvas} aria-hidden="true" />
      <div className="sweep" aria-hidden="true" />

      <div className="angel-brand">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M12 1l2.2 8.8L23 12l-8.8 2.2L12 23l-2.2-8.8L1 12l8.8-2.2z" />
        </svg>
        <span>Shared Workspace</span>
      </div>

      <div className="angel-copy">
        <p className="eyebrow">Work · Together · Achieve more</p>
        <h2>
          Your Shared Space
          <br />
          for Greater Things
        </h2>
        <p className="pitch">Organize files, manage schedules, and collaborate — all in one place.</p>
        <i className="gold-rule" />
      </div>

      <button className="angel-theme" onClick={toggleTheme} aria-label="Switch between light and dark mode" type="button">
        <span className="i-sun"><Icon name="sun" /></span>
        <span className="i-moon"><Icon name="moon" /></span>
      </button>
    </div>
  )
}
