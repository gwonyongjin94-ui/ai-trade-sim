// 자료 모드 (1단계): 고른 나라의 2023년 자료와 모든 교역 상대. 지도에는 큰 상대 8곳으로 가는 흐름선.
// 디자인은 지정학 해설 영상의 지도 문법을 따른다: 어두운 지도 한 장, 원형 국기 배지, 흰 곡선(수출)·붉은 점선(수입),
// 녹색 = 고른 나라, 우상단 작은 출처, 하단 자막 한 줄.

import { useMemo } from 'react'
import type { ModeProps } from '../App'
import { CountryPanel } from '../CountryPanel'
import { COUNTRIES, DATA, GOODS, METRICS, PARTNER_METRIC, partners, useTrade, usdMillion, usdShort, type Direction } from '../data'
import { ANCHOR, viewFor } from '../geo'
import { mix, Screen } from '../Screen'
import type { Arc } from '../WorldMap'

const TOP_ARCS = 8
const RAMP: [string, string] = ['#2C4744', '#7DBB96']

export function DataMode({ iso, rest, setIso, setRest, onMode }: ModeProps) {
  const dir: Direction = rest[0] === 'import' ? 'import' : 'export'
  const good = GOODS.some((g) => g.id === rest[1]) ? rest[1] : null
  const metricId = rest[2] === PARTNER_METRIC || METRICS.some((m) => m.id === rest[2]) ? rest[2] : null
  const set = (p: { dir?: Direction; good?: string | null; metric?: string | null }) => {
    const d = p.dir ?? dir
    const g = p.good !== undefined ? p.good : good
    const m = p.metric !== undefined ? p.metric : metricId
    setRest([d, g ?? '', m ?? ''])
  }

  const c = DATA.countries[iso]
  const trade = useTrade(iso)
  const rows = useMemo(() => (trade.file ? partners(trade.file, dir, good) : null), [trade.file, dir, good])
  const arcs: Arc[] = ANCHOR[iso]
    ? (rows ?? []).filter((r) => ANCHOR[r.iso]).slice(0, TOP_ARCS).map((r) => ({ iso: r.iso, value: r.value, label: usdShort(r.value) }))
    : []
  const goodName = good ? GOODS.find((g) => g.id === good)!.name : null
  const word = dir === 'export' ? '수출' : '수입'
  const flowName = `${goodName ?? '상품'} ${word}`

  // 지표 보기: 나라 지표, 또는 고른 나라와의 교역액 (값이 클수록 밝은 녹색)
  const byPartner = useMemo(() => new Map((rows ?? []).map((r) => [r.iso, r.value])), [rows])
  const partnerMode = metricId === PARTNER_METRIC
  const metric = METRICS.find((m) => m.id === metricId) ?? null
  const valueOf = (x: string): number | undefined => (partnerMode ? byPartner.get(x) : metric ? metric.get(DATA.countries[x])?.value : undefined)
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
    ? (x: string) => {
        if (partnerMode && x === iso) return null
        const v = valueOf(x)
        return v === undefined || v <= 0 ? null : mix(RAMP[0], RAMP[1], scale.t(v))
      }
    : null

  const subtitle = !rows
    ? trade.error ? `${c.name}: 교역 자료를 불러오지 못했습니다` : `${c.name}의 2023년 ${flowName} 자료를 불러오는 중…`
    : rows.length
      ? `${c.name}의 2023년 ${flowName} — ` + rows.slice(0, 3).map((r, i) => `${i + 1}위 ${DATA.countries[r.iso].name} ${usdMillion(r.value)}`).join(' · ')
      : `${c.name}: 2023년 ${flowName} 자료가 없습니다`

  const sources = new Set<string>(['CEPII BACI (2023)'])
  for (const v of [c.gdp, c.population, c.laborForce, c.investmentPct]) if (v) sources.add(v.source)

  return (
    <Screen
      mode="data"
      onMode={onMode}
      map={{ view: viewFor(iso), selected: iso, dir, arcs, fillFor, onSelect: setIso }}
      controls={
        <>
          <div className="seg" role="group" aria-label="흐름 방향">
            <button className={dir === 'export' ? 'on' : ''} onClick={() => set({ dir: 'export' })}>수출</button>
            <button className={dir === 'import' ? 'on' : ''} onClick={() => set({ dir: 'import' })}>수입</button>
          </div>
          <label className="ctl">
            <span>품목</span>
            <select value={good ?? ''} onChange={(e) => set({ good: e.target.value || null })}>
              <option value="">전체 상품</option>
              {GOODS.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </label>
          <label className="ctl">
            <span>지표 보기</span>
            <select value={metricId ?? ''} onChange={(e) => set({ metric: e.target.value || null })}>
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
        </>
      }
      sources={[...sources].join(' · ')}
      subtitle={subtitle}
      hoverText={(h) => {
        if (!h.iso) return { title: h.name, body: '자료 없음' }
        if (scale) {
          const v = valueOf(h.iso)
          const label = partnerMode ? `${c.name}${dir === 'export' ? '→' : '←'}${h.name}` : metric!.name
          return { title: h.name, body: h.iso === iso ? '선택한 나라' : `${label} ${v ? formatOf(v) : '자료 없음'}` }
        }
        if (h.iso === iso) return { title: h.name, body: '선택한 나라' }
        const v = byPartner.get(h.iso)
        return { title: h.name, body: v ? `${c.name}${dir === 'export' ? '→' : '←'}${h.name} ${usdMillion(v)}` : '클릭하면 이 나라를 봅니다' }
      }}
      panel={<CountryPanel iso={iso} dir={dir} good={good} rows={rows} error={trade.error} onSelect={setIso} />}
      panelLabel={`${c.name} 자료 보기`}
      panelKey={iso}
    />
  )
}
