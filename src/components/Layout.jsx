import { NavLink, Outlet } from 'react-router-dom'
import { LayoutDashboard, Users, UsersRound, Landmark, Wallet, FileStack, History, LogOut } from 'lucide-react'
import { useAuth } from '../lib/AuthContext'

const navItems = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/borrowers', label: 'Borrowers', icon: Users },
  { to: '/groups', label: 'Groups', icon: UsersRound },
  { to: '/loans', label: 'Loans', icon: Landmark },
  { to: '/payments', label: 'Payments', icon: Wallet },
  { to: '/documents', label: 'Documents', icon: FileStack },
  { to: '/activity', label: 'Activity', icon: History }
]

export default function Layout() {
  const { signOut } = useAuth()

  return (
    <div className="min-h-screen bg-ledger flex">
      <aside className="w-60 shrink-0 border-r border-ledgerline bg-white flex flex-col">
        <div className="px-5 py-5 border-b border-ledgerline">
          <div className="flex items-center gap-2">
            <Landmark className="w-5 h-5 text-brass" strokeWidth={1.5} />
            <span className="font-display text-xl text-ink tracking-tight">Ledger</span>
          </div>
          <p className="text-[11px] text-slatey mt-0.5 stamp">MICROFINANCE REGISTER</p>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded text-sm transition ${
                  isActive
                    ? 'bg-vault text-white'
                    : 'text-ink hover:bg-ledger'
                }`
              }
            >
              <Icon className="w-4 h-4" strokeWidth={1.75} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-3 py-4 border-t border-ledgerline">
          <button
            onClick={signOut}
            className="flex items-center gap-3 px-3 py-2 rounded text-sm text-slatey hover:bg-ledger w-full"
          >
            <LogOut className="w-4 h-4" strokeWidth={1.75} />
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-8 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
