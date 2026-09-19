import { useEffect, useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import Sidebar from './components/Sidebar'
import { ReminderListCard } from './components/KnowledgeListCard'
import { fetchReminders, R_PAGE_SIZE, type ReminderDto } from './api'

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })

export default function AllReminders({ onLogout }: { onLogout: () => void }) {
  const [reminders, setReminders] = useState<ReminderDto[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    fetchReminders('all', page)
      .then((r) => {
        if (cancelled) return
        setReminders(r.reminders)
        setTotal(r.total)
        setLoading(false)
      })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof Error && err.message === 'Session expired') onLogout()
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [page, onLogout])

  const totalPages = Math.max(1, Math.ceil(total / R_PAGE_SIZE))

  return (
    <div className="flex min-h-screen bg-[#F4F7FE]">
      <Sidebar userInitial="S" activeNav="Calendar" />
      <main className="flex-1 p-8 pt-16 md:pt-8 max-w-5xl mx-auto w-full">
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={() => { window.location.hash = '' }}
            className="flex items-center gap-1.5 text-sm font-medium text-[#1B2559] hover:opacity-70 transition-opacity cursor-pointer"
            aria-label="Back to dashboard"
          >
            <ArrowLeft size={16} aria-hidden /> Back
          </button>
          <h1 className="text-[28px] font-bold tracking-tight text-[#1B2559]">All Reminders</h1>
        </div>

        {loading ? (
          <p className="text-sm text-[#A3AED0]">Loading...</p>
        ) : (
          <ReminderListCard
            title=""
            emptyText="Belum ada reminder. Set lewat bot Telegram."
            files={reminders.map((r) => ({
              id: r.id,
              name: r.text,
              date: `${fmtDate(r.remindAt)} ${new Date(r.remindAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`,
              size: r.status,
              type: 'document' as const
            }))}
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
