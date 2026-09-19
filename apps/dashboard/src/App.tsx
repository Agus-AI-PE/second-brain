import { useEffect, useState } from 'react'
import LoginPage from './LoginPage'
import Dashboard from './Dashboard'
import AllReminders from './AllReminders'
import AllKnowledge from './AllKnowledge'
import { getSession } from './api'

function currentRoute(): string {
  return window.location.hash.replace(/^#\/?/, '')
}

export default function App() {
  const [authed, setAuthed] = useState(() => getSession() !== null)
  const [route, setRoute] = useState(currentRoute)

  useEffect(() => {
    const onHash = () => setRoute(currentRoute())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  if (!authed) return <LoginPage onSuccess={() => setAuthed(true)} />
  if (route === 'all-reminders') return <AllReminders onLogout={() => setAuthed(false)} />
  if (route === 'all-knowledge') return <AllKnowledge onLogout={() => setAuthed(false)} />
  return <Dashboard onLogout={() => setAuthed(false)} />
}
