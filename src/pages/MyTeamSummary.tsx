import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

type RosterRow = {
  team?: string | null
  code?: string | null
  team_code?: string | null
}

export default function MyTeamSummary() {
  const { profile } = useAuth()
  const [teamNames, setTeamNames] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function loadMyTeam() {
      setLoading(true)
      setError('')
      const { data, error: rosterError } = await supabase.rpc('my_roster')

      if (cancelled) return
      if (rosterError) {
        setError('Your team assignment could not be loaded. Please contact your workspace owner.')
        setTeamNames([])
      } else {
        const rows = (data ?? []) as RosterRow[]
        const names = [...new Set(rows
          .flatMap(row => [row.code, row.team_code, row.team])
          .map(value => value?.trim())
          .filter((value): value is string => Boolean(value)))]
        setTeamNames(names)
      }
      setLoading(false)
    }

    void loadMyTeam()
    return () => { cancelled = true }
  }, [profile?.id])

  return (
    <section className="page-stack" aria-labelledby="my-team-heading">
      <div className="page-heading">
        <div>
          <p className="eyebrow">INSTALLATION TALLY</p>
          <h1 id="my-team-heading">My Team</h1>
          <p className="muted">Your personal team assignment from the employee roster.</p>
        </div>
      </div>

      <article className="card" style={{ maxWidth: 620, padding: '1.4rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.8rem', marginBottom: '1.1rem' }}>
          <div aria-hidden="true" style={{ width: 44, height: 44, borderRadius: 14, display: 'grid', placeItems: 'center', background: 'var(--accent-soft, rgba(34,197,94,.12))', fontSize: '1.25rem' }}>♙</div>
          <div>
            <p className="muted" style={{ margin: 0, fontSize: '.82rem' }}>SIGNED-IN EMPLOYEE</p>
            <h2 style={{ margin: '.2rem 0 0' }}>{profile?.full_name || profile?.email || 'My account'}</h2>
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--border, rgba(128,128,128,.2))', paddingTop: '1rem' }}>
          <p className="muted" style={{ margin: '0 0 .45rem', fontSize: '.82rem' }}>ASSIGNED TEAM</p>
          {loading ? <p className="muted">Loading your team…</p> :
            error ? <p role="alert">{error}</p> :
            teamNames.length ? teamNames.map(name => <div key={name} style={{ fontSize: '1.25rem', fontWeight: 750, overflowWrap: 'anywhere' }}>{name}</div>) :
            <p className="muted">No team assigned to this account yet.</p>}
        </div>
      </article>
    </section>
  )
}
