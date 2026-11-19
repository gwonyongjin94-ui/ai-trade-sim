// 지도 화면이 쓰는 자료와 숫자 표기. 자료는 scripts/build-map-data.ts가 만든 map-2023.json 하나다.

import raw from './data/map-2023.json'

export type Val = { value: number; year: number; source: string } | null
export type HofKey = 'pdi' | 'idv' | 'mas' | 'uai' | 'lto' | 'ivr'

export type Country = {
  iso: string
  iso2: string
  mapId: string
  name: string
  bloc: string
  gdp: Val
  population: Val
  gdpPerCapita: Val
  laborForce: Val
  investmentPct: Val
  exportsPct: Val
  importsPct: Val
  merchExports: Val
  merchImports: Val
  structure: {
    agriculturePct: Val
    industryPct: Val
    manufacturingPct: Val
    servicesPct: Val
    resourceRentsPct: Val
  } | null
  culture: { values: Record<HofKey, number | null>; note?: string; source: string } | null
}

export type Flow = { from: string; to: string; total: number; values: Record<string, number>; source: string }

export type MapData = {
  meta: {
    year: number
    flowNote: string
    goods: { id: string; name: string }[]
    sources: { id: string; name: string; detail: string; link?: string }[]
  }
  blocs: Record<string, { name: string; members: string[] }>
  countries: Record<string, Country>
  flows: Flow[]
}

export const DATA = raw as unknown as MapData
export const COUNTRIES = Object.values(DATA.countries)
export const BY_MAP_ID = new Map(COUNTRIES.map((c) => [c.mapId, c]))
export const GOODS = DATA.meta.goods

export type Direction = 'export' | 'import'

// 고른 나라의 교역 상대 (백만 달러). good이 null이면 전체 상품
export function partners(iso: string, dir: Direction, good: string | null) {
  const rows = DATA.flows
    .filter((f) => (dir === 'export' ? f.from === iso : f.to === iso))
    .map((f) => ({
      iso: dir === 'export' ? f.to : f.from,
      value: good ? f.values[good] ?? 0 : f.total,
      source: f.source,
    }))
    .filter((r) => r.value > 0)
  return rows.sort((a, b) => b.value - a.value)
}

// 고른 나라가 지도에 있는 나라들과 주고받은 상품 구성
export function goodsMix(iso: string, dir: Direction) {
  const sums: Record<string, number> = {}
  for (const f of DATA.flows) {
    if (dir === 'export' ? f.from !== iso : f.to !== iso) continue
    for (const [g, v] of Object.entries(f.values)) sums[g] = (sums[g] ?? 0) + v
  }
  const total = Object.values(sums).reduce((s, v) => s + v, 0)
  return { total, rows: GOODS.map((g) => ({ ...g, value: sums[g.id] ?? 0 })).sort((a, b) => b.value - a.value) }
}

// ---- 숫자 표기 (한국식 만·억·조)
const n0 = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 })
const n1 = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1, minimumFractionDigits: 1 })

export function usd(v: number) {
  if (v >= 1e12) return `${n1.format(v / 1e12)}조 달러`
  if (v >= 1e8) return `${n0.format(v / 1e8)}억 달러`
  if (v >= 1e4) return `${n0.format(v / 1e4)}만 달러`
  return `${n0.format(v)}달러`
}
export const usdMillion = (m: number) => usd(m * 1e6)
export function usdShort(m: number) {
  const v = m * 1e6
  if (v >= 1e12) return `${n1.format(v / 1e12)}조$`
  if (v >= 1e8) return `${n0.format(v / 1e8)}억$`
  return `${n0.format(v / 1e4)}만$`
}
export function people(v: number) {
  if (v >= 1e8) return `${n1.format(v / 1e8)}억 명`
  if (v >= 1e4) return `${n0.format(v / 1e4)}만 명`
  return `${n0.format(v)}명`
}
export const pct = (v: number) => `${n1.format(v)}%`
export const perCapita = (v: number) => `${n0.format(v)}달러`

// ---- 지도 색칠 기준
export type Metric = {
  id: string
  name: string
  get: (c: Country) => Val
  log: boolean
  format: (v: number) => string
}

export const METRICS: Metric[] = [
  { id: 'gdp', name: 'GDP', get: (c) => c.gdp, log: true, format: usd },
  { id: 'gdpPerCapita', name: '1인당 GDP', get: (c) => c.gdpPerCapita, log: true, format: perCapita },
  { id: 'population', name: '인구', get: (c) => c.population, log: true, format: people },
  { id: 'exportsPct', name: '수출 / GDP', get: (c) => c.exportsPct, log: false, format: pct },
  { id: 'manufacturingPct', name: '제조업 비중', get: (c) => c.structure?.manufacturingPct ?? null, log: false, format: pct },
  { id: 'investmentPct', name: '투자율', get: (c) => c.investmentPct, log: false, format: pct },
]
