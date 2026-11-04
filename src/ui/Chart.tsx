// 작은 SVG 선 그래프. 임기 경계에 세로 점선.

export interface Series {
  label: string
  values: number[]
  color: string
  dash?: string
  width?: number
}

const W = 520
const H = 170
const PAD = { l: 40, r: 8, t: 8, b: 20 }

export function LineChart({ title, series, quarters, termQuarters, fmt = (x) => x.toFixed(0), note }: { title: string; series: Series[]; quarters: number; termQuarters: number; fmt?: (x: number) => string; note?: string }) {
  const vals = series.flatMap((s) => s.values.slice(0, quarters)).filter(Number.isFinite)
  let lo = vals.length ? Math.min(...vals) : 0
  let hi = vals.length ? Math.max(...vals) : 1
  if (hi - lo < 1e-6) {
    lo -= 1
    hi += 1
  }
  const span = hi - lo
  lo -= span * 0.08
  hi += span * 0.08
  const x = (i: number) => PAD.l + ((W - PAD.l - PAD.r) * i) / Math.max(1, quarters - 1)
  const y = (v: number) => PAD.t + ((H - PAD.t - PAD.b) * (hi - v)) / (hi - lo)
  const ticks = [lo + (hi - lo) * 0.1, (lo + hi) / 2, hi - (hi - lo) * 0.1]
  return (
    <figure className="card p-3">
      <figcaption className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
        <span className="font-semibold">{title}</span>
        <span className="flex flex-wrap gap-x-3 text-xs text-slate-500">
          {series.map((s) => (
            <span key={s.label} className="inline-flex items-center gap-1">
              <svg width="18" height="6">
                <line x1="0" y1="3" x2="18" y2="3" stroke={s.color} strokeWidth={s.width ?? 2} strokeDasharray={s.dash} />
              </svg>
              {s.label}
            </span>
          ))}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={title}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} className="stroke-slate-200 dark:stroke-slate-800" />
            <text x={PAD.l - 4} y={y(t) + 3} textAnchor="end" className="fill-slate-500 text-[10px]">
              {fmt(t)}
            </text>
          </g>
        ))}
        {Array.from({ length: Math.floor((quarters - 1) / termQuarters) }, (_, k) => (k + 1) * termQuarters).map((q) => (
          <g key={q}>
            <line x1={x(q - 0.5)} x2={x(q - 0.5)} y1={PAD.t} y2={H - PAD.b} strokeDasharray="2 3" className="stroke-slate-400" />
            <text x={x(q - 0.5) + 3} y={H - PAD.b - 3} className="fill-slate-400 text-[9px]">
              {q / termQuarters + 1}대
            </text>
          </g>
        ))}
        {Array.from({ length: Math.ceil(quarters / 4) }, (_, k) => k * 4).map((q) => (
          <text key={q} x={x(q)} y={H - 6} textAnchor="middle" className="fill-slate-500 text-[9px]">
            {q / 4 + 1}년
          </text>
        ))}
        {series.map((s) => {
          const pts = s.values.slice(0, quarters).map((v, i) => (Number.isFinite(v) ? `${x(i)},${y(v)}` : null)).filter(Boolean)
          if (pts.length === 0) return null
          return pts.length === 1 ? (
            <circle key={s.label} cx={pts[0]!.split(',')[0]} cy={pts[0]!.split(',')[1]} r={3} fill={s.color} />
          ) : (
            <polyline key={s.label} points={pts.join(' ')} fill="none" stroke={s.color} strokeWidth={s.width ?? 2} strokeDasharray={s.dash} strokeLinejoin="round" />
          )
        })}
      </svg>
      {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
    </figure>
  )
}
