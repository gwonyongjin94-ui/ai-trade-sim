// 한 분기의 시장 균형 (v2: 지역 7곳, 부문 12개). v1(src/engine/market.ts)의 구조를 지역 N곳으로 넓혔다.
//  - 각 지역은 12개 부문의 자기 품종을 생산한다. 자본은 분기 안에서 부문에 묶여 있고, 노동 일부가 임금이 높은 부문으로 옮겨간다
//  - 교역재: 구매자 i는 물품 g를 모든 공급처 j의 품종에서 CES(σ_g)로 섞는다
//      P_ig^(1−σ) = Σ_j β_ijg · q_ijg^(1−σ),  q_ijg = p_jg × (1 + j가 i에게 매긴 수출세) × (1 + i가 j에게 매긴 관세)
//    관세와 수출 통제는 상대국마다 다르다. 전면 금지(수출세 ∞)면 그 품종은 i의 시장에서 사라진다
//  - 서비스·건설은 교역되지 않는다
//  - 소득 = 생산자 가격 GDP + 관세 수입 + 수출세 수입. 지출 = 소득 + 적자(고정 이전). 투자율 ι만큼 투자, 나머지 소비
//  - 소비 바구니: w_s ∝ s_s · (P_s/P0_s)^(1−ε_s) · (e/e0)^(η_s−1),  투자 바구니: 소득항 없이 같은 방식
// 84개 생산자 가격을 초과수요 비율로 조정하는 tâtonnement으로 균형을 찾는다. 기준재: 세계 생산을 시작 가격으로 평가한 값을 고정.

import { wedge } from './calibrate'
import { perRegion, REGIONS } from './regions'
import type { RegionId } from './regions'
import { N_SECTORS, N_TRADED, SECTORS } from './sectors'
import { EXPORT_TAX_EQUIVALENT } from './types'
import type { MarketResult, Policy, RegionCalibration } from './types'

export interface Supply {
  output: number[]
  labor: number[]
  elasticity: number[]
}

export interface MarketInput {
  supply: (r: RegionId, prices: number[]) => Supply
  policies: Record<RegionId, Policy>
  calib: Record<RegionId, RegionCalibration>
  demandPrice: Record<RegionId, number[]>
  demandExpenditure: Record<RegionId, number>
  numerairePrice: Record<RegionId, number[]>
  startPrices: Record<RegionId, number[]>
}

interface Quote {
  composite: number
  share: Record<RegionId, number> // 지출 중 공급처별 비중
  price: Record<RegionId, number> // 공급처별 도착 가격 (Infinity = 살 수 없음)
}

function quote(i: RegionId, g: number, prices: Record<RegionId, number[]>, input: MarketInput): Quote {
  const sigma = SECTORS[g].substitutionElasticity
  const beta = input.calib[i].beta
  const price = {} as Record<RegionId, number>
  const term = {} as Record<RegionId, number>
  let total = 0
  for (const j of REGIONS) {
    const q = prices[j][g] * wedge(i, j, g, input.policies)
    price[j] = q
    const t = beta[j][g] > 0 && Number.isFinite(q) ? beta[j][g] * Math.pow(q, 1 - sigma) : 0
    term[j] = t
    total += t
  }
  return {
    composite: Math.pow(total, 1 / (1 - sigma)),
    share: perRegion((j) => term[j] / total),
    price,
  }
}

// 소비자물가 (시작 가격 대비 라스파이레스형, 소비 바구니 기본 비중)
export function cpiOf(c: RegionCalibration, composite: number[], basePrice: number[]): number {
  let s = 0
  for (let k = 0; k < N_SECTORS; k++) s += c.consumptionShare[k] * (composite[k] / basePrice[k])
  return s
}

function basket(base: number[], composite: number[], basePrice: number[], incomeRatio: number, consumption: boolean): number[] {
  const raw = base.map((s0, k) => {
    if (s0 <= 0) return 0
    const sec = SECTORS[k]
    let r = s0 * Math.pow(composite[k] / basePrice[k], 1 - sec.priceElasticity)
    if (consumption) r *= Math.pow(incomeRatio, sec.incomeElasticity - 1)
    return r
  })
  const sum = raw.reduce((t, x) => t + x, 0)
  return raw.map((x) => x / sum)
}

export function solveMarket(input: MarketInput, maxIter = 6000, tol = 1e-9): MarketResult {
  const { policies, calib } = input
  const logP = perRegion((r) => input.startPrices[r].map((p) => Math.log(p)))
  const prices = perRegion((r) => logP[r].map(Math.exp))
  let tariffRevenue = perRegion(() => 0)
  let exportTaxRevenue = perRegion(() => 0)

  let result: MarketResult | null = null
  let maxExcess = Infinity
  let iter = 0
  for (; iter < maxIter; iter++) {
    for (const r of REGIONS) for (let k = 0; k < N_SECTORS; k++) prices[r][k] = Math.exp(logP[r][k])
    const supply = perRegion((r) => input.supply(r, prices[r]))
    const output = perRegion((r) => supply[r].output)

    const quotes = perRegion((i) => Array.from({ length: N_TRADED }, (_, g) => quote(i, g, prices, input)))
    const composite = perRegion((i) => SECTORS.map((_, k) => (k < N_TRADED ? quotes[i][k].composite : prices[i][k])))
    const gdp = perRegion((r) => output[r].reduce((t, y, k) => t + y * prices[r][k], 0))
    const income = perRegion((r) => gdp[r] + tariffRevenue[r] + exportTaxRevenue[r])
    const expenditure = perRegion((r) => income[r] + calib[r].deficit)

    const spending = perRegion(() => new Array<number>(N_SECTORS).fill(0))
    const consumptionQty = perRegion(() => new Array<number>(N_SECTORS).fill(0))
    const investmentQty = perRegion(() => new Array<number>(N_SECTORS).fill(0))
    for (const r of REGIONS) {
      const c = calib[r]
      const inv = expenditure[r] * policies[r].investmentRate
      const con = expenditure[r] - inv
      const cpi = cpiOf(c, composite[r], input.demandPrice[r])
      const ratio = con / c.population / cpi / input.demandExpenditure[r]
      const wc = basket(c.consumptionShare, composite[r], input.demandPrice[r], ratio, true)
      const wi = basket(c.investmentShare, composite[r], input.demandPrice[r], 1, false)
      for (let k = 0; k < N_SECTORS; k++) {
        spending[r][k] = con * wc[k] + inv * wi[k]
        consumptionQty[r][k] = (con * wc[k]) / composite[r][k]
        investmentQty[r][k] = (inv * wi[k]) / composite[r][k]
      }
    }

    // purchases[i][j][g]: i가 j에게서 산 수량
    const purchases = perRegion((i) =>
      perRegion((j) => quotes[i].map((q, g) => (q.share[j] > 0 ? (spending[i][g] * q.share[j]) / q.price[j] : 0))),
    )

    const newTariff = perRegion((i) =>
      REGIONS.reduce((t, j) => {
        if (j === i) return t
        return t + purchases[i][j].reduce((u, m, g) => (m > 0 ? u + (m * quotes[i][g].price[j] * policies[i].tariffs[j][g]) / (1 + policies[i].tariffs[j][g]) : u), 0)
      }, 0),
    )
    const newExportTax = perRegion((j) =>
      REGIONS.reduce((t, i) => {
        if (i === j) return t
        return t + purchases[i][j].reduce((u, m, g) => {
          const xt = EXPORT_TAX_EQUIVALENT[policies[j].exportControls[i][g]]
          return m > 0 && Number.isFinite(xt) ? u + m * prices[j][g] * xt : u
        }, 0)
      }, 0),
    )

    // 초과수요
    maxExcess = 0
    const excess = perRegion(() => new Array<number>(N_SECTORS).fill(0))
    const demandOf = (j: RegionId, k: number) =>
      k < N_TRADED ? REGIONS.reduce((t, i) => t + purchases[i][j][k], 0) : spending[j][k] / prices[j][k]
    for (const r of REGIONS) {
      for (let k = 0; k < N_SECTORS; k++) {
        const z = (demandOf(r, k) - output[r][k]) / output[r][k]
        excess[r][k] = z
        maxExcess = Math.max(maxExcess, Math.abs(z))
      }
    }
    const revenueGap = REGIONS.reduce(
      (m, r) => Math.max(m, Math.abs(newTariff[r] - tariffRevenue[r]) / gdp[r], Math.abs(newExportTax[r] - exportTaxRevenue[r]) / gdp[r]),
      0,
    )
    tariffRevenue = newTariff
    exportTaxRevenue = newExportTax

    result = {
      prices: perRegion((r) => [...prices[r]]),
      compositePrice: composite,
      output,
      labor: perRegion((r) => supply[r].labor),
      purchases,
      consumptionQty,
      investmentQty,
      spending,
      gdp,
      income,
      expenditure,
      tariffRevenue,
      exportTaxRevenue,
      converged: false,
      iterations: iter + 1,
      maxExcess,
    }
    if (maxExcess < tol && revenueGap < tol) {
      result.converged = true
      break
    }

    // 준뉴턴 가격 조정: 품종 수요의 가격탄력성 근사치로 나눈다
    for (const j of REGIONS) {
      for (let k = 0; k < N_SECTORS; k++) {
        const sec = SECTORS[k]
        let el: number
        if (k < N_TRADED) {
          let total = 0
          let weighted = 0
          for (const i of REGIONS) {
            const m = purchases[i][j][k]
            if (m <= 0) continue
            const sh = quotes[i][k].share[j]
            total += m
            weighted += m * (sec.substitutionElasticity * (1 - sh) + sec.priceElasticity * sh)
          }
          el = total > 0 ? weighted / total : sec.substitutionElasticity
        } else {
          el = sec.priceElasticity
        }
        el += supply[j].elasticity[k]
        const step = (0.6 * excess[j][k]) / Math.max(0.15, el)
        logP[j][k] += Math.max(-0.5, Math.min(0.5, step))
      }
    }
    // 기준재 정규화
    const baseValue = REGIONS.reduce((t, r) => t + output[r].reduce((u, y, k) => u + y * input.numerairePrice[r][k], 0), 0)
    const value = REGIONS.reduce((t, r) => t + output[r].reduce((u, y, k) => u + y * Math.exp(logP[r][k]), 0), 0)
    const shift = Math.log(baseValue / value)
    for (const r of REGIONS) for (let k = 0; k < N_SECTORS; k++) logP[r][k] += shift
  }

  if (!result) throw new Error('market solver did not run')
  result.iterations = iter + 1
  result.maxExcess = maxExcess
  return result
}

