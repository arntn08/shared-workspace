
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth'

type Department = {
  id: string
  code: string
  name: string
  active: boolean
}

type Team = {
  id: string
  department_id: string
  code: string
  name: string
  active: boolean
}

export default function TeamSettings() {
  const { profile } = useAuth()
  const canManage =
    profile?.active === true &&
    (profile.role === 'owner' || profile.role === 'editor')

  const [departments, setDepartments] = useState<Department[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [departmentId, setDepartmentId] = useState('')
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [showInactive, setShowInactive] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [viewDepartmentId, setViewDepartmentId] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')

    const [departmentResult, teamResult] = await Promise.all([
      supabase
        .from('installation_departments')
        .select('id,code,name,active')
        .order('code'),
      supabase
        .from('installation_teams')
        .select('id,department_id,code,name,active')
        .order('code')
    ])

    if (departmentResult.error || teamResult.error) {
      setError(
        departmentResult.error?.message ||
        teamResult.error?.message ||
        'Unable to load teams.'
      )
    } else {
      const nextDepartments = (departmentResult.data ?? []) as Department[]
      setDepartments(nextDepartments)
      setTeams((teamResult.data ?? []) as Team[])

      if (
        !departmentId ||
        !nextDepartments.some((d) => d.id === departmentId)
      ) {
        setDepartmentId(
          nextDepartments.find((d) => d.active)?.id ||
          nextDepartments[0]?.id ||
          ''
        )
      }
    }

    setLoading(false)
  }, [departmentId])

  useEffect(() => {
    void load()
  }, [load])

  function resetForm() {
    setEditId(null)
    setCode('')
    setName('')
    setMessage('')
  }

  function startEdit(team: Team) {
    setEditId(team.id)
    setDepartmentId(team.department_id)
    setCode(team.code)
    setName(team.name)
    setError('')
    setMessage('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function saveTeam() {
    if (!canManage) return

    const cleanCode = code.trim().toUpperCase()
    const cleanName = name.trim()

    if (!departmentId || !cleanCode || !cleanName) {
      setError('Choose a department and enter a team code and name.')
      return
    }

    setSaving(true)
    setError('')
    setMessage('')

    const payload = {
      department_id: departmentId,
      code: cleanCode,
      name: cleanName
    }

    const result = editId
      ? await supabase
          .from('installation_teams')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', editId)
      : await supabase
          .from('installation_teams')
          .insert({ ...payload, active: true })

    setSaving(false)

    if (result.error) {
      setError(result.error.message)
      return
    }

    resetForm()
    setMessage(editId ? 'Team updated.' : 'Team added.')
    await load()
  }

  async function toggleActive(team: Team) {
    if (!canManage) return

    const action = team.active ? 'deactivate' : 'activate'
    if (
      !window.confirm(
        `${action === 'deactivate' ? 'Deactivate' : 'Activate'} ${team.code}?`
      )
    ) return

    setError('')
    setMessage('')

    const { error: updateError } = await supabase
      .from('installation_teams')
      .update({
        active: !team.active,
        updated_at: new Date().toISOString()
      })
      .eq('id', team.id)

    if (updateError) {
      setError(updateError.message)
      return
    }

    setMessage(`${team.code} ${team.active ? 'deactivated' : 'activated'}.`)
    await load()
  }

  const visibleDepartments = departments.filter(
    (department) => showInactive || department.active
  )
    const visibleDepartments = departments.filter((department) => {
  const matchesDepartment =
    viewDepartmentId === 'all' || department.id === viewDepartmentId

  const matchesStatus = showInactive || department.active

  return matchesDepartment && matchesStatus
 })

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Team Settings</h1>
          <p className="muted" style={{ margin: 0 }}>
            Manage installation teams and departments
          </p>
        </div>
      </div>

      {error && <div className="notice error">{error}</div>}
      {message && <div className="notice">{message}</div>}

      {canManage && (
        <div className="card" style={{ marginBottom: '1rem' }}>
          <h2>{editId ? 'Edit team' : 'Add a team'}</h2>

          <div
            className="grid"
            style={{
              gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
              gap: '0.75rem'
            }}
          >
            <label>
              Department
              <select
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
              >
                {departments.filter((d) => d.active).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.code} — {d.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Team code
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. AHBA_SLI021"
                maxLength={50}
              />
            </label>

            <label>
              Team name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. SLI Team 21"
                maxLength={100}
              />
            </label>
          </div>

          <div className="row" style={{ marginTop: '0.75rem', gap: '0.5rem' }}>
            <button
              className="btn primary"
              onClick={() => void saveTeam()}
              disabled={saving || departments.filter((d) => d.active).length === 0}
            >
              {saving ? 'Saving…' : editId ? 'Save changes' : 'Add team'}
            </button>

            {editId && (
              <button className="btn" onClick={resetForm} disabled={saving}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)}
            style={{ width: 'auto' }}
          />
          <label style={{ display: 'block', marginBottom: '1rem' }}>
              View department
                <select
                  value={viewDepartmentId}
                    onChange={(e) => setViewDepartmentId(e.target.value)}
          >
                <option value="all">All departments</option>
                {departments
                .filter((department) => showInactive || department.active)
                .map((department) => (
                <option key={department.id} value={department.id}>
                {department.code} — {department.name}
              </option>
              ))}
           </select>
          </label>
          Show inactive departments and teams
        </label>
        <p className="muted" style={{ marginBottom: 0 }}>
          Deactivated teams are hidden from the active team list. They are not deleted.
        </p>
      </div>

      {loading ? (
        <div className="card"><p className="muted">Loading teams…</p></div>
      ) : visibleDepartments.map((department) => {
        const departmentTeams = teams.filter(
          (team) =>
            team.department_id === department.id &&
            (showInactive || team.active)
        )

        return (
          <div className="card" key={department.id} style={{ marginBottom: '1rem' }}>
            <div className="row between" style={{ gap: '0.75rem', flexWrap: 'wrap' }}>
              <div>
                <h2 style={{ marginBottom: '0.25rem' }}>
                  {department.code}
                </h2>
                <p className="muted" style={{ margin: 0 }}>
                  {department.name}
                </p>
              </div>
              <span className="muted">
                {departmentTeams.length} {departmentTeams.length === 1 ? 'team' : 'teams'}
              </span>
            </div>

            {departmentTeams.length === 0 ? (
              <p className="muted" style={{ marginBottom: 0 }}>
                No {showInactive ? '' : 'active '}teams in this department yet.
              </p>
            ) : (
              <div style={{ overflowX: 'auto', marginTop: '0.75rem' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: 'left', padding: '0.65rem' }}>Code</th>
                      <th style={{ textAlign: 'left', padding: '0.65rem' }}>Team name</th>
                      <th style={{ textAlign: 'left', padding: '0.65rem' }}>Status</th>
                      {canManage && (
                        <th style={{ textAlign: 'right', padding: '0.65rem' }}>Actions</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {departmentTeams.map((team) => (
                      <tr key={team.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td style={{ padding: '0.65rem' }}>{team.code}</td>
                        <td style={{ padding: '0.65rem' }}>{team.name}</td>
                        <td style={{ padding: '0.65rem' }}>
                          {team.active ? 'Active' : 'Inactive'}
                        </td>
                        {canManage && (
                          <td style={{ padding: '0.65rem', textAlign: 'right' }}>
                            <div
                              className="row"
                              style={{ justifyContent: 'flex-end', gap: '0.4rem', flexWrap: 'wrap' }}
                            >
                              <button
                                className="btn small"
                                onClick={() => startEdit(team)}
                              >
                                Edit
                              </button>
                              <button
                                className="btn small"
                                onClick={() => void toggleActive(team)}
                              >
                                {team.active ? 'Deactivate' : 'Activate'}
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}
