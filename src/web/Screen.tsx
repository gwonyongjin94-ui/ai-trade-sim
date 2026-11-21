// 모든 모드가 같이 쓰는 화면 틀: 지도 한 장, 왼쪽 위 모드 탭·조작, 오른쪽 위 출처, 아래 자막(과 타임라인), 오른쪽 패널.
// 좁은 화면에서는 패널이 아래에서 올라오는 판이 된다.

import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react'
import { WorldMap, type Hover } from './WorldMap'

export type Mode = 'data' | 'tariff' | 'sim' | 'replay'
export const MODES: { id: Mode; name: string }[] = [
  { id: 'data', name: '자료' },
  { id: 'tariff', name: '관세' },
  { id: 'sim', name: '정책 실험' },
  { id: 'replay', name: 'AI 리플레이' },
]

type MapProps = Omit<ComponentProps<typeof WorldMap>, 'onHover' | 'padRight' | 'padBottom'>

type Props = {
  mode: Mode
  onMode: (m: Mode) => void
  map: MapProps
  controls: ReactNode
  sources: string
  subtitle: string
  hoverText: (h: NonNullable<Hover>) => { title: string; body: string } | null
  panel: ReactNode
  panelLabel: string // 좁은 화면에서 패널을 펼치는 단추 글
  panelKey: string // 이 값이 바뀌면 패널을 맨 위로
  bottomBar?: ReactNode // 타임라인 (정책 실험·리플레이)
}

export function Screen({ mode, onMode, map, controls, sources, subtitle, hoverText, panel, panelLabel, panelKey, bottomBar }: Props) {
  const [hover, setHover] = useState<Hover>(null)
  const [width, setWidth] = useState(() => window.innerWidth)
  const [height, setHeight] = useState(() => window.innerHeight)
  const [panelOpen, setPanelOpen] = useState(true)
  const panelRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const onResize = () => { setWidth(window.innerWidth); setHeight(window.innerHeight) }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 })
  }, [panelKey])

  const mobile = width < 760
  const padRight = mobile ? 0 : 400
  const padBottom = mobile && panelOpen ? Math.round(height * 0.45) : 0
  const barH = bottomBar ? (mobile ? 44 : 50) : 0
  const tip = hover ? hoverText(hover) : null

  return (
    <div className="app">
      <WorldMap {...map} onHover={setHover} padRight={padRight} padBottom={padBottom + barH} />
      <div className="grain" aria-hidden="true" />

      <div className="brand">AI 무역 지도</div>
      <nav className="modes" aria-label="화면">
        {MODES.map((m) => (
          <button key={m.id} className={m.id === mode ? 'on' : ''} onClick={() => onMode(m.id)} aria-current={m.id === mode ? 'page' : undefined}>
            {m.name}
          </button>
        ))}
      </nav>

      <div className="controls">{controls}</div>

      <div className="source" style={{ right: padRight + 18 }}>출처: {sources}</div>

      <div className="subtitle" style={{ right: padRight, bottom: padBottom + barH + 22 }}>
        <span>{subtitle}</span>
      </div>

      {bottomBar && (
        <div className="bottom-bar" style={{ right: padRight, bottom: padBottom, height: barH }}>
          {bottomBar}
        </div>
      )}

      {tip && hover && (
        <div className="tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <strong>{tip.title}</strong>
          <span>{tip.body}</span>
        </div>
      )}

      <aside ref={panelRef} className={`panel ${mobile ? 'mobile' : ''} ${panelOpen ? 'open' : 'closed'}`}>
        {mobile && (
          <button className="panel-toggle" onClick={() => setPanelOpen((o) => !o)}>
            {panelOpen ? '자료 접기' : panelLabel}
          </button>
        )}
        {(!mobile || panelOpen) && panel}
      </aside>
    </div>
  )
}

export function mix(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16))
  const k = Math.max(0, Math.min(1, t))
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * k)).join(',')})`
}

// 증감 색: 줄면 적색, 늘면 파랑 (녹색은 '고른 나라'에만 쓴다)
export const DIVERGE = { neg: '#C9566C', zero: '#34414F', pos: '#6A98D8' }
export function divergeColor(v: number, span: number) {
  const t = Math.max(-1, Math.min(1, v / (span || 1)))
  return t < 0 ? mix(DIVERGE.zero, DIVERGE.neg, Math.sqrt(-t)) : mix(DIVERGE.zero, DIVERGE.pos, Math.sqrt(t))
}

// 분기 표기: 0 → "1년차 1분기"
export const quarterLabel = (q: number) => `${Math.floor(q / 4) + 1}년차 ${(q % 4) + 1}분기`
