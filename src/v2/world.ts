// v2 분기 동학: 시장균형(분기 안의 노동 이동 포함) → 지표 → 자본 축적. v1(src/engine/world.ts)과 같은 순서다.
// 시작 세계는 2023년 자료로 보정한 정상상태라서 v1처럼 수백 분기를 미리 돌릴 필요가 없다.

import { ENGINE } from '../engine/params'
import { BASE, basePolicies, calibrate } from './calibrate'
import { cpiOf, solveMarket } from './market'
import type { Supply } from './market'
import { perRegion, REGIONS } from './regions'
import type { RegionId } from './regions'
import { N_TRADED, NECESSITIES, SECTOR_IDS, SECTORS } from './sectors'
import { EXPORT_TAX_EQUIVALENT } from './types'
import type { Base, Indicators, MarketResult, Policy, QuarterResult, RegionCalibration, RegionState, World } from './types'

export const clonePolicy = (p: Policy): Policy => ({
  tariffs: perRegion((j) => [...p.tariffs[j]]),
  exportControls: perRegion((j) => [...p.exportControls[j]]),
  investmentRate: p.investmentRate,
})

export const statusQuoPolicies = basePolicies

// 분기 안의 공급. 노동은 직전 배치에서 그 분기 가격 기준 임금 균등 배치 쪽으로 mobility만큼 옮긴다 (v1과 같다)
export function supplyAt(state: RegionState, c: RegionCalibration, prices: number[], m: number): Supply {
  const a = ENGINE.alpha
  const pull = state.capital.map((k, s) => k * Math.pow(prices[s] * c.productivity[s], 1 / a))
  const pullSum = pull.reduce((t, x) => t + x, 0)
  const labor = state.labor.map((l, s) => (1 - m) * l + (m * c.labor * pull[s]) / pullSum)
  return {
    labor,
    output: labor.map((l, s) => c.productivity[s] * Math.pow(l, 1 - a) * Math.pow(state.capital[s], a)),
    elasticity: labor.map((l) => ((m * (1 - a)) / a) * (1 - l / c.labor)),
  }
}

function runMarket(world: World, policies: Record<RegionId, Policy>, mobility: number): MarketResult {
  return solveMarket({
    supply: (r, prices) => supplyAt(world.state[r], world.calib[r], prices, mobility),
    policies,
    calib: world.calib,
    demandPrice: world.base.compositePrice,
    demandExpenditure: world.base.demandExpenditure,
    numerairePrice: world.base.producerPrice,
    startPrices: world.lastPrices,
  })
}

const realInvestmentOf = (world: World, market: MarketResult, r: RegionId) =>
  market.investmentQty[r].reduce((t, q, s) => t + q * world.base.compositePrice[r][s], 0)

// 분기 말 부문별 자본: 감가상각 + 생산액 비중대로 나눈 신규 투자 (v1과 같다)
function nextCapital(world: World, market: MarketResult, r: RegionId): number[] {
  const value = market.output[r].map((y, s) => y * market.prices[r][s])
  const total = value.reduce((t, v) => t + v, 0)
  const inv = realInvestmentOf(world, market, r)
  return world.state[r].capital.map((k, s) => (1 - ENGINE.delta) * k + (inv * value[s]) / total)
}

// 국경 가격(수출세 포함, 관세 제외)으로 잰 i의 j로부터의 수입액
function borderImports(market: MarketResult, policies: Record<RegionId, Policy>, i: RegionId, j: RegionId): number {
  if (i === j) return 0
  return market.purchases[i][j].reduce((t, m, g) => {
    const xt = EXPORT_TAX_EQUIVALENT[policies[j].exportControls[i][g]]
    return m > 0 && Number.isFinite(xt) ? t + m * market.prices[j][g] * (1 + xt) : t
  }, 0)
}

// 물품별 교역액 flows[수출][수입][교역재] (국경 가격, 모형 단위 = 2023년 USD 10억, 연율)
export function goodFlows(market: MarketResult, policies: Record<RegionId, Policy>): Record<RegionId, Record<RegionId, number[]>> {
  return perRegion((j) =>
    perRegion((i) =>
      Array.from({ length: N_TRADED }, (_, g) => {
        if (i === j) return 0
        const m = market.purchases[i][j][g]
        const xt = EXPORT_TAX_EQUIVALENT[policies[j].exportControls[i][g]]
        return m > 0 && Number.isFinite(xt) ? m * market.prices[j][g] * (1 + xt) : 0
      }),
    ),
  )
}

export function computeIndicators(world: World, market: MarketResult, policies: Record<RegionId, Policy>): Record<RegionId, Indicators> {
  return perRegion((r) => {
    const c = world.calib[r]
    const base = world.base
    const pop = c.population
    const rc = market.consumptionQty[r].reduce((t, q, s) => t + q * base.compositePrice[r][s], 0) / pop
    const shortageByGood = Array.from({ length: N_TRADED }, (_, g) => {
      if (!NECESSITIES.includes(g)) return 0
      const floor = SECTORS[g].subsistence * base.perCapitaConsumption[r][g]
      return Math.max(0, 1 - market.consumptionQty[r][g] / pop / floor)
    })
    const shortage = shortageByGood.reduce((t, x) => t + x, 0)
    const realConsumption = (100 * rc) / base.realConsumption[r]
    const realGdp = (100 * market.output[r].reduce((t, y, s) => t + y * base.producerPrice[r][s], 0)) / base.realGdp[r]
    const importsFrom = perRegion((j) => borderImports(market, policies, r, j))
    const exportsTo = perRegion((j) => borderImports(market, policies, j, r))
    const importsValue = REGIONS.reduce((t, j) => t + importsFrom[j], 0)
    const exportsValue = REGIONS.reduce((t, j) => t + exportsTo[j], 0)
    const realInvestment = realInvestmentOf(world, market, r)
    const capital = (100 * nextCapital(world, market, r).reduce((t, k) => t + k, 0)) / base.capital[r]
    const livingStandard = realConsumption * Math.max(0, 1 - ENGINE.shortagePenalty * shortage)
    const c0 = base.realConsumption[r] * pop
    const welfare = (100 * ((livingStandard / 100) * c0 + realInvestment)) / (c0 + base.realInvestment[r])
    const importDependence = Array.from({ length: N_TRADED }, (_, g) => {
      const total = market.spending[r][g]
      return total > 0 ? 1 - (market.purchases[r][r][g] * market.prices[r][g]) / total : 0
    })
    const cpi = 100 * cpiOf(c, market.compositePrice[r], base.compositePrice[r])
    return {
      livingStandard,
      welfare,
      realConsumption,
      shortage,
      shortageByGood,
      realGdp,
      realGdpUsd: (c.gdpUsd * realGdp) / 100,
      nominalGdp: (100 * market.gdp[r]) / base.realGdp[r],
      nominalGdpUsd: (c.gdpUsd * market.gdp[r]) / base.realGdp[r],
      cpi,
      inflation: cpi / world.lastCpi[r] - 1,
      importsValue,
      exportsValue,
      importsFrom,
      exportsTo,
      tradeOpenness: (importsValue + exportsValue) / market.gdp[r],
      tariffRevenueShare: market.tariffRevenue[r] / market.income[r],
      realInvestment,
      capital,
      importDependence,
    }
  })
}

export function stepQuarter(world: World, policies: Record<RegionId, Policy>): { world: World; result: QuarterResult } {
  const market = runMarket(world, policies, ENGINE.laborMobility)
  const indicators = computeIndicators(world, market, policies)
  const next: World = {
    ...world,
    quarter: world.quarter + 1,
    state: perRegion((r) => ({ labor: [...market.labor[r]], capital: nextCapital(world, market, r) })),
    lastPrices: market.prices,
    lastCpi: perRegion((r) => indicators[r].cpi),
  }
  return {
    world: next,
    result: { quarter: world.quarter, market, indicators, policies: perRegion((r) => clonePolicy(policies[r])) },
  }
}

// 현재 상태와 정책에서 시장만 풀어본다 (상태는 바꾸지 않음)
export function evaluateQuarter(world: World, policies: Record<RegionId, Policy>, mobility = ENGINE.laborMobility) {
  const market = runMarket(world, policies, mobility)
  return { market, indicators: computeIndicators(world, market, policies) }
}

let cached: World | null = null

// 2023년 자료로 보정한 시작 세계. 모든 가격 1, 2023년 관세·통제에서 시장이 청산되는 정상상태
export function createWorld(): World {
  if (cached) return cached
  const { calib, state } = calibrate()
  const ones = () => SECTOR_IDS.map(() => 1)
  const consumption = perRegion((r) => SECTOR_IDS.reduce((t, id) => t + BASE.data[r].consumptionSpend[id], 0))
  const investment = perRegion((r) => SECTOR_IDS.reduce((t, id) => t + BASE.data[r].investmentSpend[id], 0))
  const base: Base = {
    compositePrice: perRegion(ones),
    producerPrice: perRegion(ones),
    demandExpenditure: perRegion((r) => consumption[r] / calib[r].population),
    perCapitaConsumption: perRegion((r) => SECTOR_IDS.map((id) => BASE.data[r].consumptionSpend[id] / calib[r].population)),
    realConsumption: perRegion((r) => consumption[r] / calib[r].population),
    realInvestment: investment,
    realGdp: perRegion((r) => SECTOR_IDS.reduce((t, id) => t + BASE.data[r].production[id], 0)),
    capital: perRegion((r) => state[r].capital.reduce((t, k) => t + k, 0)),
  }
  cached = { quarter: 0, calib, state, base, lastPrices: perRegion(ones), lastCpi: perRegion(() => 100) }
  return cached
}

