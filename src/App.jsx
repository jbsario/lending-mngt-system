import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/AuthContext'
import Layout from './components/Layout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Borrowers from './pages/Borrowers'
import Groups from './pages/Groups'
import Loans from './pages/Loans'
import LoanDetail from './pages/LoanDetail'
import Schedule from './pages/Schedule'
import Payments from './pages/Payments'
import Documents from './pages/Documents'
import Activity from './pages/Activity'

function Gate() {
  const { session, loading } = useAuth()

  if (loading) {
    return <div className="min-h-screen bg-ledger flex items-center justify-center text-slatey text-sm">Loading…</div>
  }

  if (!session) {
    return <Login />
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/borrowers" element={<Borrowers />} />
        <Route path="/groups" element={<Groups />} />
        <Route path="/loans" element={<Loans />} />
        <Route path="/loans/:id" element={<LoanDetail />} />
        <Route path="/schedule" element={<Schedule />} />
        <Route path="/payments" element={<Payments />} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/activity" element={<Activity />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}
