import { TrendingUp, TrendingDown, ArrowRight } from 'lucide-react'

export type StatMetric = {
  label: string
  value: string
  delta: number | null
}

function Delta({ delta }: { delta: number | null }) {
  if (delta === 0 || delta === null) return null
  const up = delta > 0
  const Icon = up ? TrendingUp : TrendingDown
  return (
    <span className={`flex items-center gap-1 text-[13px] font-semibold ${up ? 'text-[#05CD99]' : 'text-[#EE5D50]'}`}>
      <Icon size={10} aria-hidden /> {Math.abs(delta).toFixed(1)}%
    </span>
  )
}

export default function StatisticsCard({ stats, onSeeAll }: { stats: StatMetric[]; onSeeAll?: () => void }) {
  return (
    <section className="w-full max-w-[760px]" aria-label="Statistics">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-[28px] font-bold tracking-tight text-[#1B2559]">Statistics</h2>
        {onSeeAll && (
          <button
            onClick={onSeeAll}
            className="flex items-center gap-1.5 text-sm font-medium text-[#1B2559] hover:opacity-70 transition-opacity cursor-pointer"
            aria-label="See all statistics"
          >
            See all <ArrowRight size={16} aria-hidden />
          </button>
        )}
      </div>

      <div className="rounded-[20px] bg-white px-8 py-7 shadow-[0_4px_18px_rgba(112,144,176,0.10)]">
        <div className="flex items-stretch max-sm:flex-col">
          {stats.map((stat, i) => (
            <div
              key={stat.label}
              role="group"
              aria-label={stat.label}
              className={`flex-1 flex flex-col gap-2 px-6 my-1 ${i === 0 ? 'pl-0' : ''} ${i === stats.length - 1 ? 'pr-0' : ''}
                ${i > 0 ? 'border-l border-[#E9EDF7] max-sm:border-l-0 max-sm:border-t max-sm:my-3 max-sm:ml-0 max-sm:pl-0 max-sm:pt-4 max-sm:border-b-0' : ''}`}
            >
              <span className="text-[11px] font-semibold uppercase tracking-widest text-[#A3AED0]">{stat.label}</span>
              <span className="text-[26px] font-bold text-[#1B2559]">{stat.value}</span>
              <Delta delta={stat.delta} />
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
