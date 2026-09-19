import { useState } from 'react'
import { LayoutGrid, Calendar, Folder, Settings, Menu, X } from 'lucide-react'

const NAV = [
  { icon: LayoutGrid, label: 'Home', hash: '' },
  { icon: Calendar, label: 'Calendar', hash: '/all-reminders' },
  { icon: Folder, label: 'Files', hash: '/all-knowledge' }
]

export default function Sidebar({ userInitial, activeNav = 'Home' }: { userInitial: string; activeNav?: string }) {
  const [open, setOpen] = useState(false)

  const navigate = (hash: string) => {
    window.location.hash = hash
    setOpen(false)
  }

  const content = (
    <>
      <div className="w-12 h-12 rounded-full bg-blue-900 text-white flex items-center justify-center font-bold text-xl shrink-0">D</div>
      <nav className="flex flex-col items-center gap-6 mt-10 flex-1">
        {NAV.map(({ icon: Icon, label, hash }) => {
          const active = label === activeNav
          return (
            <button
              key={label}
              title={label}
              aria-current={active ? 'page' : undefined}
              onClick={() => navigate(hash)}
              className={active ? 'text-gray-500' : 'text-gray-400 hover:text-gray-600 cursor-pointer'}
            >
              <Icon size={22} strokeWidth={active ? 2.5 : 2} />
            </button>
          )
        })}
      </nav>
      <button className="text-gray-400 hover:text-gray-600 mb-6"><Settings size={22} /></button>
      <div className="w-10 h-10 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center text-sm font-semibold">{userInitial}</div>
    </>
  )

  return (
    <>
      {/* Mobile: hamburger + drawer */}
      <button
        onClick={() => setOpen(true)}
        className="md:hidden fixed top-4 left-4 z-50 w-10 h-10 rounded-lg bg-white shadow border border-gray-100 flex items-center justify-center"
        aria-label="Open menu"
      >
        <Menu size={20} />
      </button>
      {open && (
        <div className="md:hidden fixed inset-0 z-40 bg-black/30" onClick={() => setOpen(false)}>
          <aside
            className="absolute left-0 top-0 h-full w-24 bg-white flex flex-col items-center py-6 px-3"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="self-end text-gray-400" onClick={() => setOpen(false)} aria-label="Close menu"><X size={20} /></button>
            {content}
          </aside>
        </div>
      )}

      {/* Desktop */}
      <aside className="hidden md:flex w-24 h-screen sticky top-0 bg-white flex-col items-center py-6 px-3 shrink-0">
        {content}
      </aside>
    </>
  )
}
