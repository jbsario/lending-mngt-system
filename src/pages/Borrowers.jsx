import { useEffect, useState } from 'react'
import { listBorrowers, createBorrower, deleteBorrower, uploadDocument } from '../lib/api'
import { Plus, Trash2, Upload, X } from 'lucide-react'

const emptyForm = { full_name: '', contact_number: '', email: '', address: '', id_type: '', id_number: '' }

export default function Borrowers() {
  const [borrowers, setBorrowers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [uploadingFor, setUploadingFor] = useState(null)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setBorrowers(await listBorrowers())
    setLoading(false)
  }

  async function handleCreate(e) {
    e.preventDefault()
    setSaving(true)
    try {
      await createBorrower(form)
      setForm(emptyForm)
      setShowForm(false)
      await load()
    } catch (err) {
      alert(err.message)
    }
    setSaving(false)
  }

  async function handleDelete(id) {
    if (!confirm('Delete this borrower? This cannot be undone.')) return
    await deleteBorrower(id)
    await load()
  }

  async function handleFileUpload(borrowerId, file, docType) {
    try {
      await uploadDocument({ file, borrowerId, docType })
      alert('Document uploaded.')
    } catch (err) {
      alert(err.message)
    }
    setUploadingFor(null)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl text-ink">Borrowers</h1>
          <p className="text-sm text-slatey mt-1">Manage individual borrower records and ID uploads.</p>
        </div>
        <button
          onClick={() => setShowForm(v => !v)}
          className="flex items-center gap-2 bg-vault text-white text-sm px-4 py-2 rounded hover:bg-vaultdark transition"
        >
          <Plus className="w-4 h-4" /> New Borrower
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="ledger-card p-5 mb-6 grid grid-cols-2 gap-4">
          <Field label="Full Name" value={form.full_name} onChange={v => setForm({ ...form, full_name: v })} required />
          <Field label="Contact Number" value={form.contact_number} onChange={v => setForm({ ...form, contact_number: v })} />
          <Field label="Email" value={form.email} onChange={v => setForm({ ...form, email: v })} type="email" />
          <Field label="ID Type" value={form.id_type} onChange={v => setForm({ ...form, id_type: v })} placeholder="e.g. National ID" />
          <Field label="ID Number" value={form.id_number} onChange={v => setForm({ ...form, id_number: v })} />
          <Field label="Address" value={form.address} onChange={v => setForm({ ...form, address: v })} />
          <div className="col-span-2 flex gap-2 justify-end">
            <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-slatey">Cancel</button>
            <button type="submit" disabled={saving} className="bg-vault text-white text-sm px-4 py-2 rounded hover:bg-vaultdark disabled:opacity-60">
              {saving ? 'Saving…' : 'Save Borrower'}
            </button>
          </div>
        </form>
      )}

      <div className="ledger-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slatey border-b border-ledgerline bg-ledger/40">
              <th className="py-3 px-4 font-medium">Name</th>
              <th className="py-3 px-4 font-medium">Contact</th>
              <th className="py-3 px-4 font-medium">ID</th>
              <th className="py-3 px-4 font-medium">Documents</th>
              <th className="py-3 px-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="py-6 px-4 text-slatey">Loading…</td></tr>
            ) : borrowers.length === 0 ? (
              <tr><td colSpan={5} className="py-6 px-4 text-slatey">No borrowers yet. Add your first one above.</td></tr>
            ) : borrowers.map(b => (
              <tr key={b.id} className="border-b border-ledgerline last:border-0">
                <td className="py-3 px-4">{b.full_name}</td>
                <td className="py-3 px-4 text-slatey">{b.contact_number || '—'}</td>
                <td className="py-3 px-4 text-slatey">{b.id_type ? `${b.id_type} · ${b.id_number || ''}` : '—'}</td>
                <td className="py-3 px-4">
                  {uploadingFor === b.id ? (
                    <UploadInline
                      onFile={(file, docType) => handleFileUpload(b.id, file, docType)}
                      onCancel={() => setUploadingFor(null)}
                    />
                  ) : (
                    <button onClick={() => setUploadingFor(b.id)} className="flex items-center gap-1 text-vault hover:underline">
                      <Upload className="w-3.5 h-3.5" /> Upload
                    </button>
                  )}
                </td>
                <td className="py-3 px-4 text-right">
                  <button onClick={() => handleDelete(b.id)} className="text-slatey hover:text-rust">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', required, placeholder }) {
  return (
    <div>
      <label className="block text-xs uppercase tracking-wide text-slatey mb-1">{label}</label>
      <input
        type={type}
        required={required}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full border border-ledgerline rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-vault/30"
      />
    </div>
  )
}

function UploadInline({ onFile, onCancel }) {
  const [docType, setDocType] = useState('ID')
  return (
    <div className="flex items-center gap-2">
      <select value={docType} onChange={e => setDocType(e.target.value)} className="border border-ledgerline rounded px-2 py-1 text-xs">
        <option>ID</option>
        <option>Loan Agreement</option>
        <option>Collateral</option>
        <option>Other</option>
      </select>
      <label className="text-xs text-vault cursor-pointer hover:underline">
        Choose file
        <input
          type="file"
          className="hidden"
          onChange={e => {
            if (e.target.files[0]) onFile(e.target.files[0], docType)
          }}
        />
      </label>
      <button onClick={onCancel} className="text-slatey"><X className="w-3.5 h-3.5" /></button>
    </div>
  )
}
