// 2023년 자료(src/data/v2-base-2023.json, scripts/build-v2-base.ts)로 엔진 상수를 정한다.
// 표준적인 CGE 보정 방식: 시작점의 모든 생산자 가격을 1로 두고, 그 가격과 2023년 관세·수출 통제에서
// 자료의 교역·생산·지출이 그대로 나오도록 가중치를 거꾸로 푼다. 그래서 시작점은 2023년 자료를 정확히 재현한다.
//  - Armington 가중치: β_ijg = (i가 j 품종에 쓴 돈의 비중) × q_ijg^(σ−1),  q = (1+수출세)(1+관세). 시작 합성재 가격은 모두 1
//  - 노동·자본: 부문별 생산액 비례 (콥-더글러스에서 임금·수익률이 같아지는 배치). 자본 총량은 정상상태 K = 실질 투자 ÷ δ
//  - 생산성: 그 배치에서 자료의 생산량이 나오는 값
//  - 바구니 비중: 자료의 소비·투자 지출 구성. 무역 수지는 고정 이전(적자)

import baseJson from '../data/v2-base-2023.json'
import { ENGINE } from '../engine/params'
import { perRegion, REGIONS } from './regions'
import type { RegionId } from './regions'
import { SECTOR_IDS, TRADED } from './sectors'
import { EXPORT_TAX_EQUIVALENT } from './types'
import type { ExportLevel, Policy, RegionCalibration, RegionState } from './types'

interface BaseRegion {
  population: number
  labor: number
  gdpUsd: number
  investmentRate: number
  production: Record<string, number>
  consumptionSpend: Record<string, number>
  investmentSpend: Record<string, number>
  deficit: number
}
interface BaseFile {
  goods: string[]
  data: Record<string, BaseRegion>
  flows: Record<string, Record<string, Record<string, number>>> // [수출][수입][물품], 국경 가격
  tariffs: Record<string, Record<string, Record<string, number>>> // [수입][수출][물품]
  exportControls: { from: string; to: string; good: string; level: number }[]
}

export const BASE = baseJson as unknown as BaseFile

if (BASE.goods.join() !== TRADED.map((s) => s.id).join()) throw new Error('v2-base-2023.json의 물품 순서가 sectors.ts와 다르다')

// 2023년 정책: 현실 관세, 미국→중국 반도체 1단계 통제. 나머지 세계의 정책은 게임 내내 이대로다
export function basePolicies(): Record<RegionId, Policy> {
  return perRegion((i) => ({
    tariffs: perRegion((j) => (i === j ? TRADED.map(() => 0) : TRADED.map((s) => BASE.tariffs[i][j][s.id]))),
    exportControls: perRegion((j) =>
      TRADED.map((s) => (BASE.exportControls.find((c) => c.from === i && c.to === j && c.good === s.id)?.level ?? 0) as ExportLevel),
    ),
    investmentRate: BASE.data[i].investmentRate,
  }))
}

// 구매자 i가 공급처 j의 g를 사는 가격 배수 (생산자 가격 대비)
export function wedge(i: RegionId, j: RegionId, g: number, policies: Record<RegionId, Policy>): number {
  if (i === j) return 1
  const xt = EXPORT_TAX_EQUIVALENT[policies[j].exportControls[i][g]]
  return (1 + xt) * (1 + policies[i].tariffs[j][g])
}

export function calibrate(): { calib: Record<RegionId, RegionCalibration>; state: Record<RegionId, RegionState> } {
  const policies = basePolicies()
  const a = ENGINE.alpha
  const calib = {} as Record<RegionId, RegionCalibration>
  const state = {} as Record<RegionId, RegionState>
  for (const i of REGIONS) {
    const d = BASE.data[i]
    const output = SECTOR_IDS.map((id) => d.production[id])
    // 국내 판매 = 생산 − 수출(생산자 가격)
    const domestic = TRADED.map((s, g) => {
      const exportsP = REGIONS.filter((j) => j !== i).reduce((t, j) => t + BASE.flows[i][j][s.id] / (1 + EXPORT_TAX_EQUIVALENT[policies[i].exportControls[j][g]]), 0)
      return output[g] - exportsP
    })
    const beta = perRegion((j) =>
      TRADED.map((s, g) => {
        // i가 j 품종에 쓴 돈 (관세 포함)
        const spend = j === i ? domestic[g] : BASE.flows[j][i][s.id] * (1 + policies[i].tariffs[j][g])
        const total = domestic[g] + REGIONS.filter((k) => k !== i).reduce((t, k) => t + BASE.flows[k][i][s.id] * (1 + policies[i].tariffs[k][g]), 0)
        return (spend / total) * Math.pow(wedge(i, j, g, policies), s.substitutionElasticity - 1)
      }),
    )
    const totalOutput = output.reduce((t, y) => t + y, 0)
    const realInvestment = SECTOR_IDS.reduce((t, id) => t + d.investmentSpend[id], 0)
    const capitalStock = realInvestment / ENGINE.delta
    const labor = output.map((y) => (d.labor * y) / totalOutput)
    const capital = output.map((y) => (capitalStock * y) / totalOutput)
    const productivity = output.map((y, s) => y / (Math.pow(labor[s], 1 - a) * Math.pow(capital[s], a)))
    const cons = SECTOR_IDS.map((id) => d.consumptionSpend[id])
    const inv = SECTOR_IDS.map((id) => d.investmentSpend[id])
    const cSum = cons.reduce((t, x) => t + x, 0)
    const iSum = inv.reduce((t, x) => t + x, 0)
    calib[i] = {
      population: d.population,
      labor: d.labor,
      gdpUsd: d.gdpUsd,
      productivity,
      beta,
      consumptionShare: cons.map((x) => x / cSum),
      investmentShare: inv.map((x) => x / iSum),
      deficit: d.deficit,
    }
    state[i] = { labor, capital }
    if (domestic.some((x) => x <= 0)) throw new Error(`${i}: 국내 판매가 0 이하인 물품이 있다`)
  }
  return { calib, state }
}
