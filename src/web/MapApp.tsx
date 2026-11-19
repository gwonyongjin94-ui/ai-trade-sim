// AI 무역 지도 1단계: 큰 세계 지도 위에 전 세계 나라의 2023년 실측 자료를 올린다.
// 디자인은 지정학 해설 영상의 지도 문법을 따른다: 어두운 지도 한 장, 원형 국기 배지, 흰 곡선(수출)·붉은 점선(수입),
// 의미 있는 두 색(녹색 = 고른 나라·성장, 적색 = 유입), 우상단 작은 출처, 하단 자막 한 줄.

import { useEffect, useMemo, useRef, useState } from 'react'
import { WorldMap, type Arc, type Hover } from './WorldMap'
import { CountryPanel } from './CountryPanel'
import { ANCHOR, viewFor } from './geo'
import { COUNTRIES, DATA, GOODS, METRICS, PARTNER_METRIC, partners, useTrade, usdMillion, usdShort, type Direction } from './data'

const TOP_ARCS = 8
const RAMP: [string, string] = ['#2C4744', '#7DBB96']

type View = { iso: string; dir: Direction; good: string | null; metric: string | null }

function readHash(): View {
  const [iso, dir, good, metric] = decodeURIComponent(location.hash.slice(1)).split('/')
  return {
    iso: iso && DATA.countries[iso] ? iso : 'KOR',
    dir: dir === 'import' ? 'import' : 'export',
    good: GOODS.some((g) => g.id === good) ? good : null,
    metric: metric === PARTNER_METRIC || METRICS.some((m) => m.id === metric) ? metric : null,
  }
}

export function MapApp() {
  const [view, setView] = useState<View>(readHash)
  const [hover, setHover] = useState<Hover>(null)
  const [width, setWidth] = useState(() => window.innerWidth)
  const [height, setHeight] = useState(() => window.innerHeight)
  const [panelOpen, setPanelOpen] = useState(true)
  const panelRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const onResize = () => { setWidth(window.innerWidth); setHeight(window.innerHeight) }
    const onHash = () => setView(readHash())
    window.addEventListener('resize', onResize)
    window.addEventListener('hashchange', onHash)
    return () => { window.removeEventListener('resize', onResize); window.removeEventListener('hashchange', onHash) }
  }, [])

  useEffect(() => {
    const h = [view.iso, view.dir, view.good ?? '', view.metric ?? ''].join('/').replace(/\/+$/, '')
    if (location.hash.slice(1) !== h) history.replaceState(null, '', `#${h}`)
  }, [view])

  // 다른 나라를 고르면 패널을 맨 위로
  useEffect(() => {
    panelRef.current?.scrollTo({ top: 0 })
  }, [view.iso])

  const set = (patch: Partial<View>) => setView((v) => ({ ...v, ...patch }))
  const mobile = width < 760
  const padRight = mobile ? 0 : 400
  const padBottom = mobile && panelOpen ? Math.round(height * 0.45) : 0

  const c = DATA.countries[view.iso]
  const trade = useTrade(view.iso)
  const rows = useMemo(() => (trade.file ? partners(trade.file, view.dir, view.good) : null), [trade.file, view.dir, view.good])
  const arcs: Arc[] = ANCHOR[view.iso]
    ? (rows ?? []).filter((r) => ANCHOR[r.iso]).slice(0, TOP_ARCS).map((r) => ({ iso: r.iso, value: r.value, label: usdShort(r.value) }))
    : []
  const goodName = view.good ? GOODS.find((g) => g.id === view.good)!.name : null
  const word = view.dir === 'export' ? '수출' : '수입'
  const flowName = `${goodName ?? '상품'} ${word}`

  // 지도 색칠: 나라 지표, 또는 고른 나라와의 교역액
  const byPartner = useMemo(() => new Map((rows ?? []).map((r) => [r.iso, r.value])), [rows])
  const partnerMode = view.metric === PARTNER_METRIC
  const metric = METRICS.find((m) => m.id === view.metric) ?? null
  const valueOf = (iso: string): number | undefined =>
    partnerMode ? byPartner.get(iso) : metric ? metric.get(DATA.countries[iso])?.value : undefined
  const formatOf = (v: number) => (partnerMode ? usdMillion(v) : metric ? metric.format(v) : '')
  const scale = useMemo(() => {
    if (!partnerMode && !metric) return null
    const vals = partnerMode
      ? [...byPartner.values()].filter((v) => v > 0)
      : COUNTRIES.map((x) => metric!.get(x)?.value).filter((v): v is number => v !== undefined && v > 0)
    if (!vals.length) return null
    const log = partnerMode || metric!.log
    const tf = (v: number) => (log ? Math.log(v) : v)
    const lo = Math.min(...vals)
    const hi = Math.max(...vals)
    return { lo, hi, log, t: (v: number) => (tf(v) - tf(lo)) / (tf(hi) - tf(lo) || 1) }
  }, [partnerMode, metric, byPartner])
  const fillFor = scale
    ? (iso: string) => {
        if (partnerMode && iso === view.iso) return null
        const v = valueOf(iso)
        return v === undefined || v <= 0 ? null : mix(RAMP[0], RAMP[1], scale.t(v))
      }
    : null

  const subtitle = !rows
    ? trade.error ? `${c.name}: 교역 자료를 불러오지 못했습니다` : `${c.name}의 2023년 ${flowName} 자료를 불러오는 중…`
    : rows.length
      ? `${c.name}의 2023년 ${flowName} — ` +
        rows.slice(0, 3).map((r, i) => `${i + 1}위 ${DATA.countries[r.iso].name} ${usdMillion(r.value)}`).join(' · ')
      : `${c.name}: 2023년 ${flowName} 자료가 없습니다`

  const sources = new Set<string>(['CEPII BACI (2023)'])
  for (const v of [c.gdp, c.population, c.laborForce, c.investmentPct]) if (v) sources.add(v.source)

  const hoverText = (() => {
    if (!hover) return null
    if (!hover.iso) return { title: hover.name, body: '자료 없음' }
    if (scale) {
      const v = valueOf(hover.iso)
      const label = partnerMode ? `${c.name}${view.dir === 'export' ? '→' : '←'}${hover.name}` : metric!.name
      return { title: hover.name, body: hover.iso === view.iso ? '선택한 나라' : `${label} ${v ? formatOf(v) : '자료 없음'}` }
    }
    if (hover.iso === view.iso) return { title: hover.name, body: '선택한 나라' }
    const v = byPartner.get(hover.iso)
    return {
      title: hover.name,
      body: v ? `${c.name}${view.dir === 'export' ? '→' : '←'}${hover.name} ${usdMillion(v)}` : '클릭하면 이 나라를 봅니다',
    }
  })()

  return (
    <div className="app">
      <WorldMap
        view={viewFor(view.iso)}
        selected={view.iso}
        dir={view.dir}
        arcs={arcs}
        fillFor={fillFor}
        onSelect={(iso) => set({ iso })}
        onHover={setHover}
        padRight={padRight}
        padBottom={padBottom}
      />
      <div className="grain" aria-hidden="true" />

      <div className="brand">AI 무역 지도</div>

      <div className="controls">
        <div className="seg" role="group" aria-label="흐름 방향">
          <button className={view.dir === 'export' ? 'on' : ''} onClick={() => set({ dir: 'export' })}>수출</button>
          <button className={view.dir === 'import' ? 'on' : ''} onClick={() => set({ dir: 'import' })}>수입</button>
        </div>
        <label className="ctl">
          <span>품목</span>
          <select value={view.good ?? ''} onChange={(e) => set({ good: e.target.value || null })}>
            <option value="">전체 상품</option>
            {GOODS.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
        </label>
        <label className="ctl">
          <span>지도 색칠</span>
          <select value={view.metric ?? ''} onChange={(e) => set({ metric: e.target.value || null })}>
            <option value="">없음</option>
            <option value={PARTNER_METRIC}>{c.name}의 {word} 상대</option>
            {METRICS.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        {scale && (
          <div className="legend">
            <span className="legend-bar" style={{ background: `linear-gradient(90deg, ${RAMP[0]}, ${RAMP[1]})` }} />
            <span className="legend-ends">
              <span>{formatOf(scale.lo)}</span>
              <span>{formatOf(scale.hi)}</span>
            </span>
            <span className="legend-note">
              {partnerMode ? `${c.name}의 ${flowName}액 · ` : ''}
              {scale.log ? '로그 눈금' : ''}
            </span>
          </div>
        )}
      </div>

      <div className="source" style={{ right: padRight + 18 }}>출처: {[...sources].join(' · ')}</div>

      <div className="subtitle" style={{ right: padRight, bottom: padBottom + 22 }}>
        <span>{subtitle}</span>
      </div>

      {hoverText && hover && (
        <div className="tooltip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          <strong>{hoverText.title}</strong>
          <span>{hoverText.body}</span>
        </div>
      )}

      <aside ref={panelRef} className={`panel ${mobile ? 'mobile' : ''} ${panelOpen ? 'open' : 'closed'}`}>
        {mobile && (
          <button className="panel-toggle" onClick={() => setPanelOpen((o) => !o)}>
            {panelOpen ? '자료 접기' : `${c.name} 자료 보기`}
          </button>
        )}
        {(!mobile || panelOpen) && (
          <CountryPanel iso={view.iso} dir={view.dir} good={view.good} rows={rows} error={trade.error} onSelect={(iso) => set({ iso })} />
        )}
      </aside>
    </div>
  )
}

function mix(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16))
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16))
  const k = Math.max(0, Math.min(1, t))
  return `rgb(${pa.map((v, i) => Math.round(v + (pb[i] - v) * k)).join(',')})`
}
