// 분기 단위 동학: 시장균형(분기 안의 노동 이동 포함) → 지표 → 자본 축적.
// 현실 시간과의 비율(10분 = 1년)은 게임 진행기(sim/game.ts)가 맡는다. 엔진은 분기만 안다.

import { CULTURE } from './culture'
import { GOODS, N_GOODS } from './goods'
import { cpiOf, solveMarket } from './market'
import type { Supply } from './market'
import { ENGINE } from './params'
import { EXPORT_TAX_EQUIVALENT, rival } from './types'
import type { Base, CountryId, CountryParams, CountryState, Indicators, MarketResult, Policy, QuarterResult, World } from './types'

export const DEFAULT_PARAMS: Record<CountryId, CountryParams> = {
  A: { population: 50, labor: 50 * CULTURE.A.participation },
  B: { population: 70, labor: 70 * CULTURE.B.participation },
}

export const STATUS_QUO_TARIFF = 0.05
export const DEFAULT_INVESTMENT = 0.22

export function statusQuoPolicy(): Policy {
  return {
    tariffs: GOODS.map(() => STATUS_QUO_TARIFF),
    exportControls: GOODS.map(() => 0),
    investmentRate: DEFAULT_INVESTMENT,
  }
}

export function freeTradePolicy(investmentRate = DEFAULT_INVESTMENT): Policy {
  return { tariffs: GOODS.map(() => 0), exportControls: GOODS.map(() => 0), investmentRate }
}

export const clonePolicy = (p: Policy): Policy => ({
  tariffs: [...p.tariffs],
  exportControls: [...p.exportControls],
  investmentRate: p.investmentRate,
})

const perCountry = <T>(f: (c: CountryId) => T): Record<CountryId, T> => ({ A: f('A'), B: f('B') })

// 분기 안의 공급. 노동은 직전 배치에서 그 분기 가격 기준 임금 균등 배치(L*) 쪽으로 mobility만큼 옮긴다.
// 콥-더글러스에서 임금이 같아지는 배치는 L*_g ∝ K_g·(p_g·A_g)^(1/α) (자본은 분기 안에서 산업에 묶여 있음).
export function supplyAt(state: CountryState, c: CountryId, totalLabor: number, prices: number[], m: number): Supply {
  const a = ENGINE.alpha
  const pull = GOODS.map((good, g) => state.capital[g] * Math.pow(prices[g] * good.productivity[c], 1 / a))
  const pullSum = pull.reduce((s, x) => s + x, 0)
  const labor = state.labor.map((l, g) => (1 - m) * l + (m * totalLabor * pull[g]) / pullSum)
  return {
    labor,
    output: GOODS.map((good, g) => good.productivity[c] * Math.pow(labor[g], 1 - a) * Math.pow(state.capital[g], a)),
    elasticity: labor.map((l) => ((m * (1 - a)) / a) * (1 - l / totalLabor)),
  }
}

function runMarket(world: World, policies: Record<CountryId, Policy>, mobility: number): MarketResult {
  return solveMarket({
    supply: (c, prices) => supplyAt(world.state[c], c, world.params[c].labor, prices, mobility),
    policies,
    params: world.params,
    demandPrice: world.base.demandPrice,
    demandExpenditure: world.base.demandExpenditure,
    numerairePrice: world.base.producerPrice,
    startPrices: world.lastPrices,
  })
}

export function computeIndicators(world: World, market: MarketResult, policies: Record<CountryId, Policy>): Record<CountryId, Indicators> {
  return perCountry((c) => {
    const pop = world.params[c].population
    const base = world.base
    let rc = 0
    for (let g = 0; g < N_GOODS; g++) {
      if (GOODS[g].category !== 'capital') rc += market.compositeQty[c][g] * base.compositePrice[c][g]
    }
    rc /= pop
    const shortageByGood = GOODS.map((good, g) => {
      if (good.category !== 'necessity') return 0
      const perCapita = market.compositeQty[c][g] / pop
      const floor = good.subsistence * base.perCapitaConsumption[c][g]
      return Math.max(0, 1 - perCapita / floor)
    })
    const shortage = shortageByGood.reduce((s, x) => s + x, 0)
    const realConsumption = (100 * rc) / base.realConsumption[c]
    const realGdp = (100 * market.output[c].reduce((s, y, g) => s + y * base.producerPrice[c][g], 0)) / base.realGdp[c]
    const r = rival(c)
    const importsValue = market.importQty[c].reduce((s, m, g) => {
      const xt = EXPORT_TAX_EQUIVALENT[policies[r].exportControls[g]]
      return s + (Number.isFinite(xt) ? m * market.prices[r][g] * (1 + xt) : 0)
    }, 0)
    const exportsValue = market.importQty[r].reduce((s, m, g) => {
      const xt = EXPORT_TAX_EQUIVALENT[policies[c].exportControls[g]]
      return s + (Number.isFinite(xt) ? m * market.prices[c][g] * (1 + xt) : 0)
    }, 0)
    const realInvestment = GOODS.reduce(
      (s, good, g) => s + (good.category === 'capital' ? market.compositeQty[c][g] * base.compositePrice[c][g] : 0),
      0,
    )
    const capital = (100 * nextCapital(world, market, c).reduce((s, k) => s + k, 0)) / base.capital[c]
    const livingStandard = realConsumption * Math.max(0, 1 - ENGINE.shortagePenalty * shortage)
    const c0 = base.realConsumption[c] * pop
    const welfare = (100 * ((livingStandard / 100) * c0 + realInvestment)) / (c0 + base.realInvestment[c])
    const importDependence = GOODS.map((_, g) => {
      const total = market.spending[c][g]
      return total > 0 ? 1 - (market.domesticQty[c][g] * market.prices[c][g]) / total : 0
    })
    const cpi = 100 * cpiOf(c, market.compositePrice[c], base.compositePrice[c])
    return {
      livingStandard,
      welfare,
      realConsumption,
      shortage,
      shortageByGood,
      realGdp,
      cpi,
      inflation: cpi / world.lastCpi[c] - 1,
      importsValue,
      exportsValue,
      tradeOpenness: (importsValue + exportsValue) / market.gdp[c],
      avgTariff: policies[c].tariffs.reduce((s, t) => s + t, 0) / N_GOODS,
      tariffRevenueShare: market.tariffRevenue[c] / market.income[c],
      realInvestment,
      capital,
      importDependence,
    }
  })
}

// 분기 말 부문별 자본: 감가상각 + 생산액 비중대로 나눈 신규 투자
function nextCapital(world: World, market: MarketResult, c: CountryId): number[] {
  const value = market.output[c].map((y, g) => y * market.prices[c][g])
  const realInvestment = GOODS.reduce(
    (s, good, g) => s + (good.category === 'capital' ? market.compositeQty[c][g] * world.base.demandPrice[c][g] : 0),
    0,
  )
  const totalValue = value.reduce((s, v) => s + v, 0)
  return world.state[c].capital.map((k, g) => (1 - ENGINE.delta) * k + (realInvestment * value[g]) / totalValue)
}

// 노동은 이번 분기에 쓴 배치를 그대로 이어간다
function evolveFactors(world: World, market: MarketResult): Record<CountryId, CountryState> {
  return perCountry((c) => ({ labor: [...market.labor[c]], capital: nextCapital(world, market, c) }))
}

// 분기 물가 상승률을 연율로 (복리)
export const annualRate = (quarterly: number) => (1 + quarterly) ** 4 - 1

export function stepQuarter(world: World, policies: Record<CountryId, Policy>): { world: World; result: QuarterResult } {
  const market = runMarket(world, policies, ENGINE.laborMobility)
  const indicators = computeIndicators(world, market, policies)
  const next: World = {
    ...world,
    quarter: world.quarter + 1,
    state: evolveFactors(world, market),
    lastPrices: market.prices,
    lastCpi: perCountry((c) => indicators[c].cpi),
  }
  return {
    world: next,
    result: { quarter: world.quarter, market, indicators, policies: perCountry((c) => clonePolicy(policies[c])) },
  }
}

// 현재 상태와 정책에서 시장만 풀어본다 (상태는 바꾸지 않음). 내시 계산 등에 사용.
// mobility를 ENGINE.staticLaborMobility로 주면 노동이 완전히 옮겨간 장기 균형(정적 비교)을 본다.
export function evaluateQuarter(world: World, policies: Record<CountryId, Policy>, mobility = ENGINE.laborMobility) {
  const market = runMarket(world, policies, mobility)
  return { market, indicators: computeIndicators(world, market, policies) }
}

function placeholderBase(): Base {
  const ones = () => GOODS.map(() => 1)
  return {
    demandPrice: { A: ones(), B: ones() },
    demandExpenditure: { A: 1, B: 1 },
    producerPrice: { A: ones(), B: ones() },
    compositePrice: { A: ones(), B: ones() },
    perCapitaConsumption: { A: ones(), B: ones() },
    realConsumption: { A: 1, B: 1 },
    realInvestment: { A: 1, B: 1 },
    realGdp: { A: 1, B: 1 },
    capital: { A: 1, B: 1 },
  }
}

function measureBase(world: World, market: MarketResult): Base {
  return {
    ...world.base,
    producerPrice: perCountry((c) => [...market.prices[c]]),
    compositePrice: perCountry((c) => [...market.compositePrice[c]]),
    perCapitaConsumption: perCountry((c) => market.compositeQty[c].map((q) => q / world.params[c].population)),
    realConsumption: perCountry((c) =>
      GOODS.reduce(
        (s, good, g) =>
          s + (good.category === 'capital' ? 0 : market.compositeQty[c][g] * market.compositePrice[c][g]),
        0,
      ) / world.params[c].population,
    ),
    realInvestment: perCountry((c) =>
      GOODS.reduce((s, good, g) => s + (good.category === 'capital' ? market.compositeQty[c][g] * market.compositePrice[c][g] : 0), 0),
    ),
    realGdp: perCountry((c) => market.output[c].reduce((s, y, g) => s + y * market.prices[c][g], 0)),
    capital: perCountry((c) => nextCapital(world, market, c).reduce((s, k) => s + k, 0)),
  }
}

let cachedStart: World | null = null

// 보정 스크립트가 엔진 상수를 바꾼 뒤 시작 세계를 다시 만들 때 쓴다
export function clearWorldCache() {
  cachedStart = null
}

// 현상 유지 정책(관세 5%, 수출 통제 없음)에서 정상상태 근처까지 돌린 세계를 게임 시작점으로 쓴다.
export function createWorld(params: Record<CountryId, CountryParams> = DEFAULT_PARAMS): World {
  if (cachedStart && params === DEFAULT_PARAMS) return cachedStart
  const state = perCountry((c) => {
    const labor = GOODS.map(() => params[c].labor / N_GOODS)
    return { labor, capital: labor.map((l) => 28 * l) }
  })
  let world: World = {
    quarter: -1000,
    params,
    state,
    base: placeholderBase(),
    lastPrices: { A: GOODS.map(() => 1), B: GOODS.map(() => 1) },
    lastCpi: { A: 100, B: 100 },
  }
  const policies = { A: statusQuoPolicy(), B: statusQuoPolicy() }

  // 1단계: 수요 기준점 잡기
  const first = evaluateQuarter(world, policies).market
  world.base.demandExpenditure = perCountry(
    (c) => first.consumptionBudget[c] / params[c].population / cpiOf(c, first.compositePrice[c], world.base.demandPrice[c]),
  )
  for (let i = 0; i < 80; i++) world = stepQuarter(world, policies).world
  const mid = evaluateQuarter(world, policies).market
  world = {
    ...world,
    base: {
      ...measureBase(world, mid),
      demandPrice: perCountry((c) => [...mid.compositePrice[c]]),
      demandExpenditure: perCountry((c) => mid.consumptionBudget[c] / params[c].population),
    },
  }
  // 2단계: 정상상태로 수렴
  for (let i = 0; i < 200; i++) world = stepQuarter(world, policies).world
  const start = evaluateQuarter(world, policies).market
  world = { ...world, quarter: 0, base: measureBase(world, start), lastPrices: start.prices, lastCpi: { A: 100, B: 100 } }
  if (params === DEFAULT_PARAMS) cachedStart = world
  return world
}
