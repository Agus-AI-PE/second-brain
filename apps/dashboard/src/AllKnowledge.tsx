import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, Search } from 'lucide-react'
import Sidebar from './components/Sidebar'
import KnowledgeListCard, { type KnowledgeFile } from './components/KnowledgeListCard'
import { fetchMemories, type MemoriesResponse, type MemoryDto } from './api'

const PAGE_SIZE = 20
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

function mapMemory(m: MemoryDto): KnowledgeFile {
  const lower = (m.content || m.sourceUrl || '').toLowerCase()
  const ext = lower.match(/\.([a-z0-9]+)$/)?.[1]
  const docKind: KnowledgeFile['docKind'] = ext === 'pdf' ? 'pdf' : ['xlsx', 'xls', 'csv'].includes(ext ?? '') ? 'sheet' : 'doc'
  const type: KnowledgeFile['type'] = m.sourceType === 'url' ? 'url'
    : m.sourceType === 'text' || m.sourceType === 'document' ? 'document'
    : m.sourceType === 'pdf' ? 'document'
    : 'image'
  return {
    id: m.id,
    name: m.content || '(file)',
    date: fmtDate(m.createdAt),
    size: m.sourceUrl ? 'archived' : m.sourceType,
    type,
    docKind: type === 'document' ? (m.sourceType === 'pdf' ? 'pdf' : docKind) : undefined
  }
}

export default function AllKnowledge({ onLogout }: { onLogout: () => void }) {
  const [state, setState] = useState<MemoriesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = (p: number, q: string) => {
    fetchMemories(p, q)
      .then((data) => setState(data))
      .catch((err) => {
        if (err instanceof Error && err.message === 'Session expired') onLogout()
      })
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load(page, query)
  }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  const onSearch = (value: string) => {
    setQuery(value)
    clearTimeout(debounce.current ?? undefined)
    debounce.current = setTimeout(() => {
      setPage(0)
      load(0, value)
    }, 300)
  }

  const memories = state?.memories ?? []
  const total = state?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="flex min-h-screen bg-[#F4F7FE]">
      <Sidebar userInitial="S" activeNav="Files" />
      <main className="flex-1 p-8 pt-16 md:pt-8 max-w-5xl mx-auto w-full">
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => { window.location.hash = '' }}
            className="flex items-center gap-1.5 text-sm font-medium text-[#1B2559] hover:opacity-70 transition-opacity cursor-pointer"
            aria-label="Back to dashboard"
          >
            <ArrowLeft size={16} aria-hidden /> Back
          </button>
          <h1 className="text-[28px] font-bold tracking-tight text-[#1B2559]">All Knowledge</h1>
        </div>

        <div className="relative mb-6 max-w-[760px]">
          <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#A3AED0]" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Cari knowledge..."
            aria-label="Search knowledge"
            className="w-full rounded-2xl bg-white py-3.5 pl-11 pr-5 text-[15px] text-[#1B2559] placeholder:text-[#A3AED0] shadow-[0_4px_18px_rgba(112,144,176,0.10)] outline-none focus:ring-2 focus:ring-gray-400/50 transition-shadow"
          />
        </div>

        {loading ? (
          <p className="text-sm text-[#A3AED0]">Loading...</p>
        ) : (
          <KnowledgeListCard
            title=""
            emptyText="Belum ada knowledge. Simpan lewat bot Telegram."
            files={memories.map(mapMemory)}
          />
        )}

        {totalPages > 1 && (
          <nav className="flex items-center justify-center gap-2 mt-8" aria-label="Pagination">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-[#1B2559] shadow-[0_4px_18px_rgba(112,144,176,0.10)] disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-70 transition-opacity cursor-pointer disabled:hover:opacity-40"
            >
              Prev
            </button>
            <span className="text-sm text-[#A3AED0] px-2">Page {page + 1} of {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-[#1B2559] shadow-[0_4px_18px_rgba(112,144,176,0.10)] disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-70 transition-opacity cursor-pointer disabled:hover:opacity-40"
            >
              Next
            </button>
          </nav>
        )}
      </main>
    </div>
  )
}
