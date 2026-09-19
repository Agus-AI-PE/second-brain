import { useEffect, useState } from 'react'
import { loginWithCode } from './api'

export default function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    document.querySelector('input')?.focus()
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await loginWithCode(code.trim())
      onSuccess()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login gagal')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#F4F7FE] flex items-center justify-center p-4">
      <form onSubmit={submit} className="bg-white rounded-[20px] shadow-[0_4px_18px_rgba(112,144,176,0.10)] px-8 py-7 w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3">
          <h1 className="text-[28px] font-bold tracking-tight text-[#1B2559]">Dashboard Login</h1>
          <p className="text-sm text-[#A3AED0] text-center">
            Kirim <span className="font-mono bg-gray-100 px-1 rounded">/dashboard</span> ke bot Telegram untuk minta kode login.
          </p>
        </div>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="000000"
          className="w-full text-center text-2xl tracking-[0.5em] font-mono rounded-2xl py-3.5 text-[#1B2559] placeholder:text-[#A3AED0] shadow-[0_4px_18px_rgba(112,144,176,0.10)] outline-none focus:ring-2 focus:ring-gray-400/50 transition-shadow"
          maxLength={6}
          required
        />
        {error && <p className="text-sm text-red-600 text-center">{error}</p>}
        <button
          type="submit"
          disabled={busy || code.length !== 6}
          className="w-full bg-[#1B2559] text-white rounded-lg py-2.5 font-medium hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
        >
          {busy ? 'Memeriksa...' : 'Login'}
        </button>
      </form>
    </div>
  )
}
