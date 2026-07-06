import { useEffect, useState } from 'react'
import { listDocuments, getDocumentUrl, deleteDocument } from '../lib/api'
import { FileText, Trash2 } from 'lucide-react'

export default function Documents() {
  const [documents, setDocuments] = useState([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setDocuments(await listDocuments())
    setLoading(false)
  }

  async function handleView(doc) {
    try {
      const url = await getDocumentUrl(doc)
      window.open(url, '_blank')
    } catch (err) {
      alert(err.message)
    }
  }

  async function handleDelete(doc) {
    if (!confirm('Delete this document?')) return
    await deleteDocument(doc)
    await load()
  }

  const filtered = filter === 'all' ? documents : documents.filter(d => d.doc_type === filter)
  const docTypes = ['all', ...new Set(documents.map(d => d.doc_type))]

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="font-display text-2xl text-ink">Documents</h1>
          <p className="text-sm text-slatey mt-1">All uploaded IDs and loan agreements across borrowers.</p>
        </div>
        <select value={filter} onChange={e => setFilter(e.target.value)} className="border border-ledgerline rounded px-3 py-2 text-sm">
          {docTypes.map(t => <option key={t} value={t}>{t === 'all' ? 'All types' : t}</option>)}
        </select>
      </div>

      <div className="ledger-card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slatey border-b border-ledgerline bg-ledger/40">
              <th className="py-3 px-4 font-medium">File</th>
              <th className="py-3 px-4 font-medium">Type</th>
              <th className="py-3 px-4 font-medium">Borrower</th>
              <th className="py-3 px-4 font-medium">Uploaded</th>
              <th className="py-3 px-4 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="py-6 px-4 text-slatey">Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={5} className="py-6 px-4 text-slatey">No documents found.</td></tr>
            ) : filtered.map(doc => (
              <tr key={doc.id} className="border-b border-ledgerline last:border-0">
                <td className="py-3 px-4">
                  <button onClick={() => handleView(doc)} className="flex items-center gap-2 hover:text-vault">
                    <FileText className="w-4 h-4 text-slatey" /> {doc.file_name}
                  </button>
                </td>
                <td className="py-3 px-4 text-slatey">{doc.doc_type}</td>
                <td className="py-3 px-4">{doc.borrowers?.full_name || '—'}</td>
                <td className="py-3 px-4 text-slatey">{new Date(doc.uploaded_at).toLocaleDateString()}</td>
                <td className="py-3 px-4 text-right">
                  <button onClick={() => handleDelete(doc)} className="text-slatey hover:text-rust">
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
