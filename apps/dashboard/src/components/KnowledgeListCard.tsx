import { Image, FileText, FileSpreadsheet, FileType2, Link, Bell, ArrowRight } from 'lucide-react'

export type KnowledgeFile = {
  id: string
  name: string
  date: string
  size: string
  type: 'image' | 'document' | 'url'
  docKind?: 'pdf' | 'sheet' | 'doc'
}

const DEFAULT_FILES: KnowledgeFile[] = [
  { id: '1', name: 'Primary-logo.svg', date: '12 Oct 2020', size: '1.2 MB', type: 'image' },
  { id: '2', name: 'Company-policy.doc', date: '28 Aug 2020', size: '8.3 MB', type: 'document', docKind: 'doc' },
  { id: '3', name: 'John-Doe-portrait.jpg', date: '20 Aug 2020', size: '3.8 MB', type: 'image' }
]

const ICON_COLOR: Record<KnowledgeFile['type'], string> = {
  image: 'text-[#A3AED0]',
  document: 'text-[#A3AED0]',
  url: 'text-[#A3AED0]'
}

function docIcon(file: KnowledgeFile): typeof FileText {
  switch (file.docKind) {
    case 'pdf': return FileType2
    case 'sheet': return FileSpreadsheet
    default: return FileText
  }
}

const PILL = 'flex items-center rounded-2xl bg-white px-5 py-3.5 shadow-[0_4px_18px_rgba(112,144,176,0.10)] transition-[box-shadow,transform] duration-150 hover:shadow-[0_6px_24px_rgba(112,144,176,0.16)] hover:-translate-y-px max-sm:px-4'

function ListHeader({ title, onSeeAll }: { title: string; onSeeAll?: () => void }) {
  return (
    <div className="flex items-center justify-between mb-5">
      <h2 className="text-2xl font-bold tracking-tight text-[#1B2559]">{title}</h2>
      {onSeeAll && (
        <button
          onClick={onSeeAll}
          className="flex items-center gap-1.5 text-sm font-medium text-[#1B2559] hover:opacity-70 transition-opacity cursor-pointer"
          aria-label={`See all ${title.toLowerCase()}`}
        >
          See all <ArrowRight size={16} aria-hidden />
        </button>
      )}
    </div>
  )
}

function EmptyPill({ text }: { text: string }) {
  return (
    <div className="rounded-2xl bg-white px-5 py-3.5 shadow-[0_4px_18px_rgba(112,144,176,0.10)]">
      <span className="text-sm font-normal text-[#A3AED0]">{text}</span>
    </div>
  )
}

export function ReminderListCard({ title = 'Reminders', files, emptyText = 'Belum ada reminder mendatang. Set lewat bot Telegram.', onSeeAll, showSeeAll = false }: { title?: string; files: KnowledgeFile[]; emptyText?: string; onSeeAll?: () => void; showSeeAll?: boolean }) {
  return (
    <section className="w-full max-w-[760px]" aria-label={title}>
      <ListHeader title={title} onSeeAll={showSeeAll && files.length >= 2 ? onSeeAll : undefined} />
      {files.length === 0 ? (
        <EmptyPill text={emptyText} />
      ) : (
        <ul className="flex flex-col gap-3">
          {files.map((file) => (
            <li key={file.id} role="listitem" className={PILL}>
              <Bell size={20} className="mr-4 shrink-0 text-[#2B3674]" aria-hidden />
              <span className="flex-1 min-w-0 truncate text-[15px] font-medium text-[#1B2559]">{file.name}</span>
              <span className="hidden sm:inline-block w-[120px] mr-10 text-right text-sm font-normal text-[#A3AED0] whitespace-nowrap">{file.date}</span>
              <span className="w-[70px] text-right text-sm font-semibold text-[#1B2554]">{file.size}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default function KnowledgeListCard({ title = 'Knowledge', files = DEFAULT_FILES, onSeeAll, showSeeAll = false, limit, emptyText }: { title?: string; files?: KnowledgeFile[]; onSeeAll?: () => void; showSeeAll?: boolean; limit?: number; emptyText?: string }) {
  const visible = limit ? files.slice(0, limit) : files
  return (
    <section className="w-full max-w-[760px]" aria-label={title}>
      <ListHeader title={title} onSeeAll={showSeeAll && files.length >= 2 ? onSeeAll : undefined} />
      {visible.length === 0 && emptyText ? (
        <EmptyPill text={emptyText} />
      ) : (
      <ul className="flex flex-col gap-3">
        {visible.map((file) => {
          const Icon = file.type === 'image' ? Image : file.type === 'url' ? Link : docIcon(file)
          return (
            <li key={file.id} role="listitem" className={PILL}>
              <Icon size={20} className={`mr-4 shrink-0 ${ICON_COLOR[file.type]}`} aria-hidden />
              <span className="flex-1 min-w-0 truncate text-[15px] font-medium text-[#1B2559]">{file.name}</span>
              <span className="hidden sm:inline-block w-[120px] mr-10 text-right text-sm font-normal text-[#A3AED0] whitespace-nowrap">{file.date}</span>
              <span className="w-[70px] text-right text-sm font-semibold text-[#1B2554]">{file.size}</span>
            </li>
          )
        })}
      </ul>
      )}
    </section>
  )
}