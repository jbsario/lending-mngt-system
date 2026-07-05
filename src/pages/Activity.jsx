import { useEffect, useState } from 'react'
import { listActivityLogs } from '../lib/api'

const actionColors = {
  create: 'bg-moss/10 text-moss',
  update: 'bg-brass/10 text-brassdark',
  delete: 'bg-rust/10 text-rust',
  restore: 'bg-vault/10 text-vault',
  payment: 'bg-vault/10 text-vault'
}

function formatWhen(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function Activity() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    listActivityLogs(300).then(setLogs).finally(() => setLoading(false))
  }, [])

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl text-ink">Activity</h1>
        <p className="text-sm text-slatey mt-1">Every change made through the app — who did what, and when.</p>
      </div>

      <div className="ledger-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slatey border-b border-ledgerline bg-ledger/40">
              <th className="py-3 px-4 font-medium">When</th>
              <th className="py-3 px-4 font-medium">Staff</th>
              <th className="py-3 px-4 font-medium">Action</th>
              <th className="py-3 px-4 font-medium">Details</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="py-6 px-4 text-slatey">Loading…</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={4} className="py-6 px-4 text-slatey">No activity recorded yet. Actions taken from here on will show up in this log.</td></tr>
            ) : logs.map(log => (
              <tr key={log.id} className="border-b border-ledgerline last:border-0">
                <td className="py-3 px-4 text-slatey whitespace-nowrap">{formatWhen(log.created)}</td>
                <td className="py-3 px-4 text-slatey">{log.user_email || '—'}</td>
                <td className="py-3 px-4">
                  <span className={`text-xs px-2 py-1 rounded ${actionColors[log.action] || 'bg-ledger text-slatey'}`}>{log.action}</span>
                </td>
                <td className="py-3 px-4">{log.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
