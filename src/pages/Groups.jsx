import { useEffect, useState } from 'react'
import { listGroups, createGroup, listBorrowers, addGroupMember, removeGroupMember } from '../lib/api'
import { Plus, UserPlus, X } from 'lucide-react'

export default function Groups() {
  const [groups, setGroups] = useState([])
  const [borrowers, setBorrowers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ group_name: '', meeting_schedule: '' })
  const [addingTo, setAddingTo] = useState(null)
  const [selectedBorrower, setSelectedBorrower] = useState('')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [g, b] = await Promise.all([listGroups(), listBorrowers()])
    setGroups(g)
    setBorrowers(b)
    setLoading(false)
  }

  async function handleCreate(e) {
    e.preventDefault()
    try {
      await createGroup(form)
      setForm({ group_name: '', meeting_schedule: '' })
      setShowForm(false)
      await load()
    } catch (err) {
      alert(err.message)
    }
  }

  async function handleAddMember(groupId) {
    if (!selectedBorrower) return
    try {
      await addGroupMember(groupId, selectedBorrower)
      setSelectedBorrower('')
      setAddingTo(null)
      await load()
    } catch (err) {
      alert(err.message)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl text-ink">Groups</h1>
          <p className="text-sm text-slatey mt-1">Joint-liability groups for group lending.</p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 bg-vault text-white text-sm px-4 py-2 rounded hover:bg-vaultdark transition"
        >
          <Plus className="w-4 h-4" /> New Group
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="ledger-card p-5 mb-6 grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs uppercase tracking-wide text-slatey mb-1">Group Name</label>
            <input
              required
              value={form.group_name}
              onChange={e => setForm({ ...form, group_name: e.target.value })}
              className="w-full border border-ledgerline rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-vault/30"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-wide text-slatey mb-1">Meeting Schedule</label>
            <input
              placeholder="e.g. Weekly - Mondays 3PM"
              value={form.meeting_schedule}
              onChange={e => setForm({ ...form, meeting_schedule: e.target.value })}
              className="w-full border border-ledgerline rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-vault/30"
            />
          </div>
          <div className="col-span-2 flex gap-2 justify-end">
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-slatey">Cancel</button>
            <button type="submit" className="bg-vault text-white text-sm px-4 py-2 rounded hover:bg-vaultdark">Save Group</button>
          </div>
        </form>
      )}

      {loading ? (
        <p className="text-slatey text-sm">Loading…</p>
      ) : groups.length === 0 ? (
        <p className="text-slatey text-sm">No groups yet. Add one above.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {groups.map(g => (
            <div key={g.id} className="ledger-card p-5">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <h3 className="font-display text-lg text-ink">{g.group_name}</h3>
                  <p className="text-xs text-slatey">{g.meeting_schedule || 'No schedule set'}</p>
                </div>
                <span className="stamp text-xs bg-ledger border border-ledgerline rounded px-2 py-1 text-slatey">
                  {g.group_members?.length || 0} members
                </span>
              </div>
              <ul className="text-sm divide-y divide-ledgerline">
                {(g.group_members || []).map(m => (
                  <li key={m.id} className="flex items-center justify-between py-1.5">
                    <span>{m.borrowers?.full_name}</span>
                    <button onClick={() => removeGroupMember(m.id).then(load)} className="text-slatey hover:text-rust">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
              {addingTo === g.id ? (
                <div className="flex items-center gap-2 mt-3">
                  <select
                    value={selectedBorrower}
                    onChange={e => setSelectedBorrower(e.target.value)}
                    className="flex-1 border border-ledgerline rounded px-2 py-1.5 text-sm"
                  >
                    <option value="">Select borrower…</option>
                    {borrowers.map(b => <option key={b.id} value={b.id}>{b.full_name}</option>)}
                  </select>
                  <button onClick={() => handleAddMember(g.id)} className="text-sm bg-vault text-white px-3 py-1.5 rounded">Add</button>
                  <button onClick={() => setAddingTo(null)} className="text-slatey"><X className="w-4 h-4" /></button>
                </div>
              ) : (
                <button onClick={() => setAddingTo(g.id)} className="flex items-center gap-1 text-vault text-sm mt-3 hover:underline">
                  <UserPlus className="w-3.5 h-3.5" /> Add member
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
