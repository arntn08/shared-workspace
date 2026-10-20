import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'
import { logAction } from '../lib/audit'
import './polish.css'

interface Ann {
  id: string
  title: string
  body: string
  teams: string[]
  pinned: boolean
  created_at: string
}

const box = { width: 'auto', minHeight: 'auto' } as const
const line = { display: 'flex', gap: '0.5rem', alignItems: 'center', fontWeight: 400, margin: 0 } as const

function ago(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export default function Announcements({ canPost }: { canPost: boolean }) {
  const { profile } = useAuth()
  const [list, setList] = useState<Ann[]>([])
  const [teamNames, setTeamNames] = useState<string[]>([])
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [teams, setTeams] = useState<string[]>([])
  const [pinned, setPinned] = useState(false)
  const [fresh, setFresh] = useState(false)

  async function load() {
    const { data } = await supabase
      .from('announcements')
      .select('*')
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(20)
    setList((data ?? []) as Ann[])
  }

  useEffect(() => {
    load()
    if (canPost) {
      supabase
        .from('teams')
        .select('name')
        .order('sort')
        .then(({ data }) => setTeamNames((data ?? []).map((x: any) => x.name as string)))
    }
    const ch = supabase
      .channel('announcements-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'announcements' }, () => {
        load()
        setFresh(true)
        setTimeout(() => setFresh(false), 4000)
      })
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [])

  async function post(e: FormEvent) {
    e.preventDefault()
    const { error } = await supabase
      .from('announcements')
      .insert({ title: title.trim(), body: body.trim(), teams, pinned, created_by: profile!.id })
    if (error) return
    await logAction(profile!.id, 'post_announcement', null, { title: title.trim() })
    setTitle('')
    setBody('')
    setTeams([])
    setPinned(false)
    setOpen(false)
    load()
  }

  async function togglePin(a: Ann) {
    await supabase.from('announcements').update({ pinned: !a.pinned }).eq('id', a.id)
    load()
  }
  async function remove(a: Ann) {
    if (!confirm('Delete this announcement?')) return
    await supabase.from('announcements').delete().eq('id', a.id)
    load()
  }

  return (
    <div className="card rise">
      <div className="row between">
        <h2 style={{ margin: 0 }}>
          Announcements {fresh && <span className="badge pulse">New</span>}
        </h2>
        {canPost && (
          <button className={`small${open ? '' : ' primary'}`} onClick={() => setOpen(!open)}>
            {open ? 'Close' : 'Post'}
          </button>
        )}
      </div>

      {open && canPost && (
        <form className="ann-form" onSubmit={post}>
          <label htmlFor="at">Title</label>
          <input id="at" value={title} onChange={(e) => setTitle(e.target.value)} required />
          <label htmlFor="ab">Message</label>
          <textarea id="ab" rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
          <label>Who should see it? (none ticked = everyone)</label>
          <div className="row">
            {teamNames.map((n) => (
              <label key={n} style={line}>
                <input
                  type="checkbox"
                  style={box}
                  checked={teams.includes(n)}
                  onChange={() => setTeams(teams.includes(n) ? teams.filter((x) => x !== n) : [...teams, n])}
                />
                {n}
              </label>
            ))}
          </div>
          <label style={{ ...line, marginTop: '0.75rem' }}>
            <input type="checkbox" style={box} checked={pinned} onChange={(e) => setPinned(e.target.checked)} />
            Pin to the top
          </label>
          <button className="primary" style={{ marginTop: '0.9rem' }}>Post announcement</button>
        </form>
      )}

      {list.length === 0 && <p className="muted" style={{ marginTop: '0.75rem' }}>Nothing new right now.</p>}
      {list.map((a) => (
        <div key={a.id} className={`ann-item${a.pinned ? ' pinned' : ''}`}>
          <div className="row between">
            <strong>{a.pinned ? '📌 ' : ''}{a.title}</strong>
            <span className="muted" style={{ fontSize: '0.8rem' }}>{ago(a.created_at)}</span>
          </div>
          {a.body && <p>{a.body}</p>}
          <div className="row" style={{ gap: '0.35rem' }}>
            {a.teams.length === 0 ? <span className="badge">Everyone</span> : a.teams.map((t) => <span key={t} className="badge">{t}</span>)}
            {canPost && (
              <>
                <button className="small" onClick={() => togglePin(a)}>{a.pinned ? 'Unpin' : 'Pin'}</button>
                <button className="small danger" onClick={() => remove(a)}>Delete</button>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
