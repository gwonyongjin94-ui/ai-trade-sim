// 분기 타임라인: 재생 · 한 분기 앞뒤 · 끌기. 정책 실험과 리플레이가 같이 쓴다
import { useEffect, useState } from 'react'
import { quarterLabel } from './Screen'

type Props = { q: number; n: number; onChange: (q: number) => void; marks?: { q: number; color: string; title: string }[]; stepMs?: number }

export function Timeline({ q, n, onChange, marks = [], stepMs = 900 }: Props) {
  const [playing, setPlaying] = useState(false)
  useEffect(() => {
    if (!playing) return
    if (q >= n - 1) { setPlaying(false); return }
    const t = setTimeout(() => onChange(q + 1), stepMs)
    return () => clearTimeout(t)
  }, [playing, q, n, onChange, stepMs])

  const play = () => {
    if (q >= n - 1) onChange(0)
    setPlaying((p) => !p || q >= n - 1)
  }
  return (
    <div className="timeline">
      <button className="tl-btn" onClick={play} aria-label={playing ? '멈춤' : '재생'}>{playing ? '❚❚' : '▶'}</button>
      <button className="tl-btn" onClick={() => { setPlaying(false); onChange(Math.max(0, q - 1)) }} aria-label="이전 분기" disabled={q === 0}>‹</button>
      <button className="tl-btn" onClick={() => { setPlaying(false); onChange(Math.min(n - 1, q + 1)) }} aria-label="다음 분기" disabled={q === n - 1}>›</button>
      <div className="tl-track">
        <input
          type="range"
          min={0}
          max={n - 1}
          step={1}
          value={q}
          onChange={(e) => { setPlaying(false); onChange(Number(e.target.value)) }}
          aria-label="분기"
        />
        <div className="tl-marks" aria-hidden="true">
          {marks.map((m) => (
            <span key={`${m.q}-${m.color}`} title={m.title} style={{ left: `${(m.q / (n - 1)) * 100}%`, background: m.color }} />
          ))}
        </div>
      </div>
      <span className="tl-label">{quarterLabel(q)}</span>
    </div>
  )
}
