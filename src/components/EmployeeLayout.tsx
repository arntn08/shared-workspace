import { Link, Navigate, Route, Routes } from 'react-router-dom'
import { useSettings } from '../lib/settings'
import EmployeeHome from '../pages/EmployeeHome'
import FileViewer from '../pages/FileViewer'
import Settings from '../pages/Settings'

export default function EmployeeLayout() {
  const [s] = useSettings()
  return (
    <div className="employee-shell">
      <div className="row between" style={{ marginBottom: '1rem' }}>
        <strong>{s.title}</strong>
        <div className="row">
          <Link to="/">Files</Link>
          <Link to="/settings">Settings</Link>
        </div>
      </div>
      <Routes>
        <Route path="/" element={<EmployeeHome settings={s} />} />
        <Route path="/file/:id" element={<FileViewer />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  )
}
