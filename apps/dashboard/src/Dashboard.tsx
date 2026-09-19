import { useEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import Sidebar from './components/Sidebar'
import KnowledgeListCard, { ReminderListCard } from './components/KnowledgeListCard'
import StatisticsCard from './components/StatisticsCard'
import { fetchMemories, fetchReminders, logout, type MemoriesResponse, type MemoryDto, type ReminderDto } from './api'
import type { KnowledgeFile } from './components/KnowledgeListCard'

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

type MemoriesState = { data: MemoriesResponse | null; error: string | null; loading: boolean }

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

export default function Dashboard({ onLogout }: { onLogout: () => void }) {
  const [state, setState] = useState<MemoriesState>({ data: null, error: null, loading: true })
  const [reminders, setReminders] = useState<ReminderDto[]>([])

  useEffect(() => {
    let cancelled = false
    fetchMemories(0)
      .then((data) => { if (!cancelled) setState({ data, error: null, loading: false }) })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof Error && err.message === 'Session expired') { onLogout(); return }
        setState({ data: null, error: err instanceof Error ? err.message : 'Failed to load', loading: false })
      })
    fetchReminders()
      .then((r) => { if (!cancelled) setReminders(r.reminders) })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof Error && err.message === 'Session expired') onLogout()
      })
    return () => { cancelled = true }
  }, [onLogout])

  const memories = state.data?.memories ?? []
  const total = state.data?.total ?? 0

  // All stats derived from real data; no placeholder numbers.
  // ponytail: delta null (tidak ada data tren historis); isi angka real kalau nanti disimpan.
  const realStats = [
    { label: 'MEMORIES', value: String(total), delta: null },
    { label: 'THIS WEEK', value: String(memories.filter((m) => Date.now() - new Date(m.createdAt).getTime() < 7 * 86400_000).length), delta: null },
    { label: 'WITH FILES', value: String(memories.filter((m) => m.sourceType !== 'text').length), delta: null },
    { label: 'REMINDERS', value: String(reminders.length), delta: null }
  ]

  return (
    <div className="flex min-h-screen bg-[#F4F7FE]">
      <Sidebar userInitial="S" />
      <main className="flex-1 p-8 pt-16 md:pt-8 max-w-5xl mx-auto w-full">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-[28px] font-bold tracking-tight text-[#1B2559]">Your Knowledge</h1>
            <p className="text-sm font-normal text-[#A3AED0]">Everything you've saved via the Telegram bot.</p>
          </div>
          <button
            onClick={() => { logout(); onLogout() }}
            className="flex items-center gap-1.5 text-sm font-medium text-[#1B2559] hover:opacity-70 transition-opacity cursor-pointer"
          >
            Logout <ArrowRight size={16} aria-hidden />
          </button>
        </div>

        {/* Statistics */}
        <div className="mb-10">
          <StatisticsCard stats={realStats} />
        </div>

        {/* Upcoming Reminders (real data) */}
        <div className="mb-10">
          <ReminderListCard
            showSeeAll
            onSeeAll={() => { window.location.hash = '/all-reminders' }}
            files={reminders.map((r) => ({
              id: r.id,
              name: r.text,
              date: `${fmtDate(r.remindAt)} ${new Date(r.remindAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`,
              size: r.status,
              type: 'document' as const
            }))}
          />
        </div>

        {/* Knowledge memories (real data) — max 4 on homepage */}
        <KnowledgeListCard
          showSeeAll
          limit={4}
          onSeeAll={() => { window.location.hash = '/all-knowledge' }}
          files={memories.map(mapMemory)}
        />
      </main>
    </div>
  )
}
