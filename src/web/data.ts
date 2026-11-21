// 지도 화면이 쓰는 자료와 숫자 표기.
// 나라별 요약(거시 지표·수출입 총액·품목 구성)은 scripts/build-world-map.ts가 만든 world-2023.json 하나로 화면에 묶인다.
// 나라 사이 교역(모든 상대 × 품목 10개)은 나라마다 public/data/trade-2023/{ISO3}.json으로 나뉘어 있고, 그 나라를 고를 때 내려받는다.

import { useEffect, useState } from 'react'
import raw from './data/world-2023.json'

export type Val = { value: number; year: number; source: string } | null
export type HofKey = 'pdi' | 'idv' | 'mas' | 'uai' | 'lto' | 'ivr'

export type Country = {
  iso: string
  iso2: string | null
  flag: boolean
  mapId: string | null
  name: string
  region: string | null
  income: string | null
  gdp: Val
  population: Val
  gdpPerCapita: Val
  laborForce: Val
  investmentPct: Val
  exportsPct: Val
  importsPct: Val
  merchExports: Val
  merchImports: Val
  expMix: number[] | null
  impMix: number[] | null
  partnerCount: { export: number; import: number }
  tradeIn: string | null // BACI가 이 곳의 교역을 합쳐 싣는 나라 (푸에르토리코 → 미국 등)
  structure: {
    agriculturePct: Val
    industryPct: Val
    manufacturingPct: Val
    servicesPct: Val
    resourceRentsPct: Val
  } | null
  culture: { values: Record<HofKey, number | null>; note?: string; source: string } | null
  tariff: { all: Val; manuf: Val; primary: Val } // 적용 관세 (수입액 가중 평균, %)
}

export type MapData = {
  meta: {
    year: number
    flowNote: string
    goods: { id: string; name: string }[]
    sources: { id: string; name: string; detail: string; link?: string }[]
    pairTariffs: { note: string; reporters: Record<string, number> } // 상대국별 관세를 신고한 수입국과 그 연도 (WITS)
  }
  countries: Record<string, Country>
}

export const DATA = raw as unknown as MapData
export const COUNTRIES = Object.values(DATA.countries)
export const BY_MAP_ID = new Map(COUNTRIES.filter((c) => c.mapId).map((c) => [c.mapId!, c]))
export const GOODS = DATA.meta.goods
const GOOD_INDEX = Object.fromEntries(GOODS.map((g, i) => [g.id, i])) as Record<string, number>

// GDP가 큰 순서 (배지를 놓는 순서에 쓴다)
export const GDP_RANK: Record<string, number> = Object.fromEntries(
  [...COUNTRIES].sort((a, b) => (b.gdp?.value ?? 0) - (a.gdp?.value ?? 0)).map((c, i) => [c.iso, i]),
)

// 품목 색 (어두운 바탕에서 구별되게, 채도는 낮게)
export const GOOD_COLOR: Record<string, string> = {
  food: '#8BB174',
  energy: '#D9915A',
  medicine: '#D9798F',
  apparel_household: '#B6A3D9',
  chemicals: '#4FB3A6',
  vehicles: '#5F86C9',
  metals: '#A39E95',
  machinery: '#C8B25C',
  semiconductors: '#8FD3E8',
  electronics: '#C77DBB',
}

export type Direction = 'export' | 'import'

// ---- 나라 사이 교역 (나라마다 따로 내려받는다)
// 한 줄 = [상대 ISO3, 합계, 품목 10개...] (백만 달러)
export type PartnerRow = [string, number, ...number[]]
export type TradeFile = { export: PartnerRow[]; import: PartnerRow[] }

const cache = new Map<string, Promise<TradeFile>>()
export function loadTrade(iso: string): Promise<TradeFile> {
  let p = cache.get(iso)
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}data/trade-2023/${iso}.json`).then((r) => {
      if (!r.ok) throw new Error(`${r.status}`)
      return r.json() as Promise<TradeFile>
    })
    p.catch(() => cache.delete(iso))
    cache.set(iso, p)
  }
  return p
}

// 고른 나라의 교역 자료. 내려받는 동안은 null
export function useTrade(iso: string): { file: TradeFile | null; error: boolean } {
  const [state, setState] = useState<{ iso: string; file: TradeFile | null; error: boolean }>({ iso, file: null, error: false })
  useEffect(() => {
    let live = true
    loadTrade(iso).then(
      (file) => live && setState({ iso, file, error: false }),
      () => live && setState({ iso, file: null, error: true }),
    )
    return () => { live = false }
  }, [iso])
  return state.iso === iso ? state : { file: null, error: false }
}

// 교역 상대 (백만 달러, 큰 순). good이 null이면 전체 상품
export function partners(file: TradeFile, dir: Direction, good: string | null) {
  const gi = good ? GOOD_INDEX[good] : -1
  return file[dir]
    .map((r) => ({ iso: r[0], value: gi >= 0 ? (r[2 + gi] as number) : r[1] }))
    .filter((r) => r.value > 0 && DATA.countries[r.iso])
    .sort((a, b) => b.value - a.value)
}

// 고른 나라가 모든 상대와 주고받은 상품 구성
export function goodsMix(iso: string, dir: Direction) {
  const c = DATA.countries[iso]
  const mix = (dir === 'export' ? c.expMix : c.impMix) ?? []
  const total = mix.reduce((s, v) => s + v, 0)
  return { total, rows: GOODS.map((g, i) => ({ ...g, value: mix[i] ?? 0 })).sort((a, b) => b.value - a.value) }
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

// ---- 지도에 표시할 지표
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
  { id: 'merchExports', name: '상품 수출액', get: (c) => c.merchExports, log: true, format: usd },
  { id: 'exportsPct', name: '수출 / GDP', get: (c) => c.exportsPct, log: false, format: pct },
  { id: 'manufacturingPct', name: '제조업 비중', get: (c) => c.structure?.manufacturingPct ?? null, log: false, format: pct },
  { id: 'investmentPct', name: '투자율', get: (c) => c.investmentPct, log: false, format: pct },
  { id: 'tariffAll', name: '평균 관세율', get: (c) => c.tariff.all, log: false, format: pct },
]
// 고른 나라와의 교역액으로 칠하기 (지표 목록 맨 위에 따로 둔다)
export const PARTNER_METRIC = 'partners'
