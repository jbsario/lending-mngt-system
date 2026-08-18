import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  listBorrowers, createBorrower, updateBorrower, deleteBorrower,
  uploadDocument, listDocuments, getDocumentUrl, deleteDocument
} from '../lib/api'
import { Plus, Pencil, Trash2, Upload, FileText, X } from 'lucide-react'

const emptyForm = { full_name: '', contact_number: '', email: '', address: '', id_type: '', id_number: '' }

export default function Borrowers() {
  const [borrowers, setBorrowers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [editing, setEditing] = useState(null)
  const [uploadingFor, setUploadingFor] = useState(null)
  const [docCounts, setDocCounts] = useState({})
  const [docsModalFor, setDocsModalFor] = useState(null)
  const [docsModalDocs, setDocsModalDocs] = useState([])
  const [docsModalLoading, setDocsModalLoading] = useState(false)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const list = await listBorrowers()
    setBorrowers(list)
    const allDocs = await listDocuments()
    const counts = {}
    for (const doc of allDocs) {
      if (doc.borrower_id) counts[doc.borrower_id] = (counts[doc.borrower_id] || 0) + 1
    }
    setDocCounts(counts)
    setLoading(false)
  }

  function closeForm() {
    setShowForm(false)
    setEditing(null)
    setForm(emptyForm)
  }

  function startEdit(b) {
    setEditing(b)
    setForm({
      full_name: b.full_name || '',
      contact_number: b.contact_number || '',
      email: b.email || '',
      address: b.address || '',
      id_type: b.id_type || '',
      id_number: b.id_number || ''
    })
    setShowForm(true)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      if (editing) {
        await updateBorrower(editing.id, form)
      } else {
        await createBorrower(form)
      }
      closeForm()
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
      await load()
    } catch (err) {
      alert(err.message)
    }
    setUploadingFor(null)
  }

  async function openDocsModal(b) {
    setDocsModalFor(b)
    setDocsModalLoading(true)
    setDocsModalDocs(await listDocuments({ borrowerId: b.id }))
    setDocsModalLoading(false)
  }

  function closeDocsModal() {
    setDocsModalFor(null)
    setDocsModalDocs([])
  }

  async function handleViewDoc(doc) {
    try {
      const url = await getDocumentUrl(doc)
      window.open(url, '_blank')
    } catch (err) {
      alert(err.message)
    }
  }

  async function handleDeleteDoc(doc) {
    if (!confirm('Delete this document?')) return
    await deleteDocument(doc)
    setDocsModalDocs(docs => docs.filter(d => d.id !== doc.id))
    setDocCounts(counts => ({ ...counts, [doc.borrower_id]: Math.max(0, (counts[doc.borrower_id] || 1) - 1) }))
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="font-display text-2xl text-ink">Borrowers</h1>
          <p className="text-sm text-slatey mt-1">Manage individual borrower records and ID uploads.</p>
        </div>
        <button
          onClick={() => (showForm ? closeForm() : setShowForm(true))}
          className="flex items-center gap-2 bg-vault text-white text-sm px-4 py-2 rounded hover:bg-vaultdark transition"
        >
          <Plus className="w-4 h-4" /> New Borrower
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="ledger-card p-5 mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {editing && (
            <p className="col-span-2 text-sm text-ink">
              Editing borrower <span className="stamp text-vault">{editing.full_name}</span>
            </p>
          )}
          <Field label="Full Name" value={form.full_name} onChange={v => setForm({ ...form, full_name: v })} required />
          <Field label="Contact Number" value={form.contact_number} onChange={v => setForm({ ...form, contact_number: v })} />
          <Field label="Email" value={form.email} onChange={v => setForm({ ...form, email: v })} type="email" />
          <Field label="ID Type" value={form.id_type} onChange={v => setForm({ ...form, id_type: v })} placeholder="e.g. National ID" />
          <Field label="ID Number" value={form.id_number} onChange={v => setForm({ ...form, id_number: v })} />
          <Field label="Address" value={form.address} onChange={v => setForm({ ...form, address: v })} />
          <div className="col-span-2 flex gap-2 justify-end">
            <button type="button" onClick={closeForm} className="px-4 py-2 text-sm text-slatey">Cancel</button>
            <button type="submit" disabled={saving} className="bg-vault text-white text-sm px-4 py-2 rounded hover:bg-vaultdark disabled:opacity-60">
              {saving ? 'Saving…' : editing ? 'Save Changes' : 'Save Borrower'}
            </button>
          </div>
        </form>
      )}

      <div className="ledger-card overflow-x-auto">
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
                <td className="py-3 px-4">
                  <Link to={`/borrowers/${b.id}`} className="text-vault hover:underline">{b.full_name}</Link>
                </td>
                <td className="py-3 px-4 text-slatey">{b.contact_number || '—'}</td>
                <td className="py-3 px-4 text-slatey">{b.id_type ? `${b.id_type} · ${b.id_number || ''}` : '—'}</td>
                <td className="py-3 px-4">
                  {uploadingFor === b.id ? (
                    <UploadInline
                      onFile={(file, docType) => handleFileUpload(b.id, file, docType)}
                      onCancel={() => setUploadingFor(null)}
                    />
                  ) : (
                    <div className="flex items-center gap-3">
                      <button onClick={() => setUploadingFor(b.id)} className="flex items-center gap-1 text-vault hover:underline">
                        <Upload className="w-3.5 h-3.5" /> Upload
                      </button>
                      {docCounts[b.id] > 0 && (
                        <button onClick={() => openDocsModal(b)} className="flex items-center gap-1 text-slatey hover:text-vault hover:underline">
                          <FileText className="w-3.5 h-3.5" /> View ({docCounts[b.id]})
                        </button>
                      )}
                    </div>
                  )}
                </td>
                <td className="py-3 px-4">
                  <div className="flex items-center gap-2 justify-end">
                    <button onClick={() => startEdit(b)} title="Edit borrower" className="text-slatey hover:text-vault">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => handleDelete(b.id)} title="Delete borrower" className="text-slatey hover:text-rust">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {docsModalFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/30" onClick={closeDocsModal} />
          <div className="relative ledger-card w-full max-w-lg max-h-[80vh] overflow-y-auto p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-lg text-ink">Documents — {docsModalFor.full_name}</h2>
              <button onClick={closeDocsModal} className="text-slatey hover:text-ink" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>
            {docsModalLoading ? (
              <p className="text-sm text-slatey">Loading…</p>
            ) : docsModalDocs.length === 0 ? (
              <p className="text-sm text-slatey">No documents uploaded for this borrower yet.</p>
            ) : (
              <ul className="divide-y divide-ledgerline text-sm">
                {docsModalDocs.map(doc => (
                  <li key={doc.id} className="flex items-center justify-between py-2.5">
                    <button onClick={() => handleViewDoc(doc)} className="flex items-center gap-2 text-ink hover:text-vault">
                      <FileText className="w-4 h-4 text-slatey" />
                      {doc.file_name}
                      <span className="text-xs text-slatey stamp">{doc.doc_type}</span>
                    </button>
                    <button onClick={() => handleDeleteDoc(doc)} className="text-slatey hover:text-rust">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
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
