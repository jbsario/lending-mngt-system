import { useState } from 'react'
import { useAuth } from '../lib/AuthContext'
import { Landmark } from 'lucide-react'

export default function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await signIn(email, password)
    if (error) setError(error.message)
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-ledger flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 justify-center mb-8">
          <Landmark className="w-6 h-6 text-brass" strokeWidth={1.5} />
          <span className="font-display text-2xl text-ink tracking-tight">Ledger</span>
        </div>
        <form onSubmit={handleSubmit} className="ledger-card p-8 space-y-4">
          <div>
            <h1 className="font-display text-lg text-ink mb-1">Staff sign in</h1>
            <p className="text-sm text-slatey">Access the lending register.</p>
          </div>
          {error && (
            <div className="text-sm text-rust bg-rust/10 border border-rust/20 rounded px-3 py-2">
              {error}
            </div>
          )}
          <div>
            <label className="block text-xs uppercase tracking-wide text-slatey mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full border border-ledgerline rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-vault/30"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide text-slatey mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full border border-ledgerline rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-vault/30"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-vault text-white rounded py-2 text-sm font-medium hover:bg-vaultdark transition disabled:opacity-60"
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="text-xs text-slatey text-center pt-2">
            Staff accounts are created in your PocketBase Admin UI under the "users" collection.
          </p>
        </form>
      </div>
    </div>
  )
}
