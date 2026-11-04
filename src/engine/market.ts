// 한 분기의 시장 균형.
//
// 구조 (Armington 2국 모형):
//  - 각국은 8개 물품 각각의 자국산 품종을 생산한다. 자본은 분기 안에서 산업에 묶여 있고,
//    노동 일부는 그 분기 가격에 반응해 임금이 높은 산업으로 옮겨간다 (특정요소 모형). 그래서 공급이 가격에 반응한다.
//  - 구매자는 물품마다 국산 품종과 수입 품종을 CES(대체탄력성 σ)로 섞는다.
//      P^(1−σ) = β·p_d^(1−σ) + (1−β)·p_m^(1−σ),  p_m = 상대국 생산자가격 × (1+수출세) × (1+관세)
//  - 소비 예산은 물품 간에 가격탄력성 ε, 소득탄력성 η를 반영한 비중으로 나뉜다. 기본 비중 s_g는 나라별 취향이다.
//      w_g ∝ s_g · (P_g / P0_g)^(1−ε_g) · (e / e0)^(η_g−1),   e = 1인당 실질 소비지출
//  - 투자 예산은 자본재 2종에 같은 방식(소득항 없음)으로 나뉜다.
//  - 소득 = 생산자 가격 기준 GDP + 관세 수입 + 수출세 수입. 소득은 투자율 ι만큼 투자, 나머지는 소비.
// 16개 품종 가격을 초과수요 비율에 따라 조정하는 tâtonnement으로 균형을 찾는다.
// 기준재: 세계 명목 생산액을 기준가격으로 평가한 값과 같게 맞춘다.

import { GOODS, N_GOODS } from './goods'
import { ENGINE } from './params'
import { COUNTRIES, EXPORT_TAX_EQUIVALENT, rival } from './types'
import type { CountryId, CountryParams, MarketResult, Policy } from './types'

// 생산자 가격이 주어졌을 때의 공급. elasticity는 가격 조정 보폭 계산용 근사치
export interface Supply {
  output: number[]
  labor: number[]
  elasticity: number[]
}

export interface MarketInput {
  supply: (c: CountryId, prices: number[]) => Supply
  policies: Record<CountryId, Policy>
  params: Record<CountryId, CountryParams>
  demandPrice: Record<CountryId, number[]>
  demandExpenditure: Record<CountryId, number>
  numerairePrice: Record<CountryId, number[]>
  startPrices: Record<CountryId, number[]>
}

const perCountry = <T>(f: (c: CountryId) => T): Record<CountryId, T> => ({ A: f('A'), B: f('B') })

interface Quote {
  composite: number
  domesticShare: number // 지출 중 국산 품종 비중
  importPrice: number // 수입 품종 도착 가격 (Infinity = 수입 불가)
}

function quote(domesticPrice: number, importPrice: number, sigma: number): Quote {
  const dTerm = ENGINE.homeBias * Math.pow(domesticPrice, 1 - sigma)
  if (!Number.isFinite(importPrice)) {
    return { composite: Math.pow(dTerm, 1 / (1 - sigma)), domesticShare: 1, importPrice }
  }
  const mTerm = (1 - ENGINE.homeBias) * Math.pow(importPrice, 1 - sigma)
  const total = dTerm + mTerm
  return { composite: Math.pow(total, 1 / (1 - sigma)), domesticShare: dTerm / total, importPrice }
}

// 물품 간 지출 비중. consumption=true면 소득항을 넣는다.
function shares(
  c: CountryId,
  goods: number[],
  composite: number[],
  basePrice: number[],
  realExpRatio: number,
  consumption: boolean,
): Map<number, number> {
  const raw = new Map<number, number>()
  let sum = 0
  for (const g of goods) {
    const good = GOODS[g]
    let r = good.baseShare[c] * Math.pow(composite[g] / basePrice[g], 1 - good.priceElasticity)
    if (consumption) r *= Math.pow(realExpRatio, good.incomeElasticity - 1)
    raw.set(g, r)
    sum += r
  }
  for (const [g, r] of raw) raw.set(g, r / sum)
  return raw
}

const CONSUMPTION_GOODS = GOODS.map((g, i) => (g.category === 'capital' ? -1 : i)).filter((i) => i >= 0)
const CAPITAL_GOODS = GOODS.map((g, i) => (g.category === 'capital' ? i : -1)).filter((i) => i >= 0)

export function landedImportPrice(
  buyer: CountryId,
  g: number,
  prices: Record<CountryId, number[]>,
  policies: Record<CountryId, Policy>,
): number {
  const seller = rival(buyer)
  const xt = EXPORT_TAX_EQUIVALENT[policies[seller].exportControls[g]]
  if (!Number.isFinite(xt)) return Infinity
  return prices[seller][g] * (1 + xt) * (1 + policies[buyer].tariffs[g])
}

// 소비자물가 (수요 기준가격 대비 라스파이레스형)
export function cpiOf(c: CountryId, composite: number[], basePrice: number[]): number {
  let s = 0
  let w = 0
  for (const g of CONSUMPTION_GOODS) {
    s += GOODS[g].baseShare[c] * (composite[g] / basePrice[g])
    w += GOODS[g].baseShare[c]
  }
  return s / w
}

export function solveMarket(input: MarketInput, maxIter = 4000, tol = 1e-9): MarketResult {
  const { policies, params } = input
  const logP = perCountry((c) => input.startPrices[c].map((p) => Math.log(p)))
  const prices = perCountry((c) => logP[c].map(Math.exp))
  let tariffRevenue = perCountry(() => 0)
  let exportTaxRevenue = perCountry(() => 0)

  let result: MarketResult | null = null
  let maxExcess = Infinity
  let iter = 0
  for (; iter < maxIter; iter++) {
    for (const c of COUNTRIES) for (let g = 0; g < N_GOODS; g++) prices[c][g] = Math.exp(logP[c][g])
    const supply = perCountry((c) => input.supply(c, prices[c]))
    const output = perCountry((c) => supply[c].output)

    const quotes = perCountry((c) =>
      GOODS.map((good, g) => quote(prices[c][g], landedImportPrice(c, g, prices, policies), good.substitutionElasticity)),
    )
    const composite = perCountry((c) => quotes[c].map((q) => q.composite))
    const gdp = perCountry((c) => output[c].reduce((s, y, g) => s + y * prices[c][g], 0))
    const income = perCountry((c) => gdp[c] + tariffRevenue[c] + exportTaxRevenue[c])
    const investmentBudget = perCountry((c) => income[c] * policies[c].investmentRate)
    const consumptionBudget = perCountry((c) => income[c] - investmentBudget[c])

    const spending = perCountry(() => new Array<number>(N_GOODS).fill(0))
    for (const c of COUNTRIES) {
      const cpi = cpiOf(c, composite[c], input.demandPrice[c])
      const realExp = consumptionBudget[c] / params[c].population / cpi
      const ratio = realExp / input.demandExpenditure[c]
      const cs = shares(c, CONSUMPTION_GOODS, composite[c], input.demandPrice[c], ratio, true)
      for (const [g, w] of cs) spending[c][g] = consumptionBudget[c] * w
      const ks = shares(c, CAPITAL_GOODS, composite[c], input.demandPrice[c], 1, false)
      for (const [g, w] of ks) spending[c][g] = investmentBudget[c] * w
    }

    const domesticQty = perCountry((c) => quotes[c].map((q, g) => (spending[c][g] * q.domesticShare) / prices[c][g]))
    const importQty = perCountry((c) =>
      quotes[c].map((q, g) => (q.domesticShare >= 1 ? 0 : (spending[c][g] * (1 - q.domesticShare)) / q.importPrice)),
    )
    const compositeQty = perCountry((c) => spending[c].map((s, g) => s / composite[c][g]))

    // 정부 수입 (다음 반복의 소득에 반영)
    const newTariff = perCountry((c) =>
      importQty[c].reduce((s, m, g) => {
        const before = quotes[c][g].importPrice / (1 + policies[c].tariffs[g])
        return s + (Number.isFinite(before) ? m * before * policies[c].tariffs[g] : 0)
      }, 0),
    )
    const newExportTax = perCountry((c) =>
      importQty[rival(c)].reduce((s, m, g) => {
        const xt = EXPORT_TAX_EQUIVALENT[policies[c].exportControls[g]]
        return s + (Number.isFinite(xt) ? m * prices[c][g] * xt : 0)
      }, 0),
    )

    // 초과수요
    maxExcess = 0
    const excess = perCountry(() => new Array<number>(N_GOODS).fill(0))
    for (const c of COUNTRIES) {
      for (let g = 0; g < N_GOODS; g++) {
        const demand = domesticQty[c][g] + importQty[rival(c)][g]
        const z = (demand - output[c][g]) / output[c][g]
        excess[c][g] = z
        maxExcess = Math.max(maxExcess, Math.abs(z))
      }
    }
    const revenueGap = COUNTRIES.reduce(
      (m, c) =>
        Math.max(
          m,
          Math.abs(newTariff[c] - tariffRevenue[c]) / gdp[c],
          Math.abs(newExportTax[c] - exportTaxRevenue[c]) / gdp[c],
        ),
      0,
    )
    tariffRevenue = newTariff
    exportTaxRevenue = newExportTax

    result = {
      prices: perCountry((c) => [...prices[c]]),
      compositePrice: composite,
      output,
      labor: perCountry((c) => supply[c].labor),
      domesticQty,
      importQty,
      compositeQty,
      spending,
      gdp,
      income,
      tariffRevenue,
      exportTaxRevenue,
      consumptionBudget,
      investmentBudget,
      converged: false,
      iterations: iter + 1,
      maxExcess,
    }
    if (maxExcess < tol && revenueGap < tol) {
      result.converged = true
      break
    }

    // 준뉴턴 가격 조정: 품종 수요의 가격탄력성 근사치로 나눈다
    for (const c of COUNTRIES) {
      for (let g = 0; g < N_GOODS; g++) {
        const good = GOODS[g]
        const homeQty = domesticQty[c][g]
        const exportQty = importQty[rival(c)][g]
        const total = homeQty + exportQty || 1
        const homeShare = quotes[c][g].domesticShare
        const exportShare = 1 - quotes[rival(c)][g].domesticShare
        const elHome = good.substitutionElasticity * (1 - homeShare) + good.priceElasticity * homeShare
        const elExport = good.substitutionElasticity * (1 - exportShare) + good.priceElasticity * exportShare
        const el = (homeQty * elHome + exportQty * elExport) / total + supply[c].elasticity[g]
        const step = (0.6 * excess[c][g]) / Math.max(0.15, el)
        logP[c][g] += Math.max(-0.5, Math.min(0.5, step))
      }
    }
    // 기준재 정규화: 이번 생산량 묶음의 값이 기준가격으로 평가한 값과 같도록
    const baseNumeraire = COUNTRIES.reduce((s, c) => s + output[c].reduce((t, y, g) => t + y * input.numerairePrice[c][g], 0), 0)
    const world = COUNTRIES.reduce((s, c) => s + output[c].reduce((t, y, g) => t + y * Math.exp(logP[c][g]), 0), 0)
    const shift = Math.log(baseNumeraire / world)
    for (const c of COUNTRIES) for (let g = 0; g < N_GOODS; g++) logP[c][g] += shift
  }

  if (!result) throw new Error('market solver did not run')
  result.iterations = iter + 1
  result.maxExcess = maxExcess
  return result
}
