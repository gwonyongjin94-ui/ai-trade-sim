// 나라 쌍 적용 관세 (World Bank WITS TradeStats-Tariff). 나라마다 따로 내려받는다: public/data/tariffs/{ISO3}.json (npm run map:data)
// imposed = 이 나라가 상대국 물품에 매기는 관세, faced = 수입국들이 이 나라 물품에 매기는 관세 (각 수입국의 신고)

import { useEffect, useState } from 'react'

// 한 줄 = [상대 ISO3, 전 품목·공산품·1차 산품 관세(%), 같은 묶음의 수입액(백만 달러), (받는 관세만) 그 수입국 자료의 연도]
export type TRow = (string | number | null)[]
export type TariffFile = { year: number | null; world: (number | null)[] | null; imposed: TRow[]; faced: TRow[] }
export const partnerOf = (r: TRow) => r[0] as string
export const rateOf = (r: TRow, gi: number) => r[1 + gi] as number | null
export const tradeOf = (r: TRow, gi: number) => (r[4 + gi] as number | null) ?? 0
export const yearOf = (r: TRow) => (r[7] as number | undefined) ?? null

export const GROUP_INDEX = { all: 0, manuf: 1, primary: 2 } as const
// 이보다 적게(백만 달러) 수입한 상대는 한두 품목이 평균을 좌우해서 지도에 칠하지 않는다
export const MIN_TRADE = 1

const cache = new Map<string, Promise<TariffFile>>()
export function loadTariffs(iso: string): Promise<TariffFile> {
  let p = cache.get(iso)
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}data/tariffs/${iso}.json`).then((r) => {
      if (!r.ok) throw new Error(`${r.status}`)
      return r.json() as Promise<TariffFile>
    })
    p.catch(() => cache.delete(iso))
    cache.set(iso, p)
  }
  return p
}

export function useTariffs(iso: string): { file: TariffFile | null; error: boolean } {
  const [state, setState] = useState<{ iso: string; file: TariffFile | null; error: boolean }>({ iso, file: null, error: false })
  useEffect(() => {
    let live = true
    loadTariffs(iso).then(
      (file) => live && setState({ iso, file, error: false }),
      () => live && setState({ iso, file: null, error: true }),
    )
    return () => { live = false }
  }, [iso])
  return state.iso === iso ? state : { file: null, error: false }
}

// 수입액 가중 평균 (관세가 없는 줄은 뺀다)
export function weighted(rows: TRow[], gi: number): { value: number; trade: number } | null {
  let w = 0
  let s = 0
  for (const r of rows) {
    const t = rateOf(r, gi)
    const m = tradeOf(r, gi)
    if (t === null || !(m > 0)) continue
    w += m
    s += t * m
  }
  return w > 0 ? { value: s / w, trade: w } : null
}

// 미중 무역전쟁 추가 관세는 WITS(TRAINS)에 없다. 시뮬레이션 블록 관세가 쓰는 PIIE(Bown) 평균
export const TRADE_WAR: Record<string, { pct: number; what: string }> = {
  'USA>CHN': { pct: 19.3, what: '미국 301조 추가 관세' },
  'CHN>USA': { pct: 21, what: '중국의 보복 관세' },
}
