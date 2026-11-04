// 이론 기준선: 현재 엔진의 수식을 그대로 써서 자유무역 결과와 내시 균형 관세(무역전쟁 균형)를 계산한다.
//  - 정적: 자본을 시작 상태에 고정하고 노동은 완전히 옮겨간 한 기간 균형만 본다 (Johnson 1953, Ossa 2014와 같은 틀)
//  - 동적: 정책을 고정한 채 한 임기(16분기)를 돌려 임기 목표로 평가한다 (노동 재배치·자본 축적 포함)
// 각국은 상대 관세를 주어진 것으로 보고 자국 목표를 최대화하는 관세를 고르고(최적 대응), 이를 수렴할 때까지 반복한다.

import { GOODS, N_GOODS } from './goods'
import type { Category } from './goods'
import { objectiveScore } from './objectives'
import { ENGINE } from './params'
import type { ObjectiveKind } from './objectives'
import { COUNTRIES, TARIFF_MAX } from './types'
import type { CountryId, Policy, QuarterResult, World } from './types'
import { clonePolicy, evaluateQuarter, freeTradePolicy, stepQuarter } from './world'

export interface BaselineSpec {
  horizon: number // 1 = 정적
  objectives: Record<CountryId, ObjectiveKind>
  groups: 'good' | 'category'
}

export function simulateConstant(world: World, policies: Record<CountryId, Policy>, horizon: number): QuarterResult[] {
  if (horizon <= 1) {
    const { market, indicators } = evaluateQuarter(world, policies, ENGINE.staticLaborMobility)
    return [{ quarter: world.quarter, market, indicators, policies }]
  }
  const out: QuarterResult[] = []
  let w = world
  for (let i = 0; i < horizon; i++) {
    const r = stepQuarter(w, policies)
    out.push(r.result)
    w = r.world
  }
  return out
}

function groupsOf(kind: 'good' | 'category'): number[][] {
  if (kind === 'good') return GOODS.map((_, g) => [g])
  const cats: Category[] = ['necessity', 'consumer', 'capital']
  return cats.map((cat) => GOODS.map((good, g) => (good.category === cat ? g : -1)).filter((g) => g >= 0))
}

const GRID = [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.65, 0.8, 1.0, 1.3, 1.6, 2.0]

function bestResponse(world: World, policies: Record<CountryId, Policy>, c: CountryId, spec: BaselineSpec): Policy {
  const groups = groupsOf(spec.groups)
  let current = clonePolicy(policies[c])
  const value = (p: Policy) =>
    objectiveScore(simulateConstant(world, { ...policies, [c]: p } as Record<CountryId, Policy>, spec.horizon), c, spec.objectives[c], spec.horizon <= 1)
  let best = value(current)
  for (let pass = 0; pass < 3; pass++) {
    let improved = false
    for (const group of groups) {
      const set = (t: number) => {
        const p = clonePolicy(current)
        for (const g of group) p.tariffs[g] = t
        return p
      }
      // 격자 탐색 후 이웃 구간에서 황금분할 정밀화
      let bestT = current.tariffs[group[0]]
      for (const t of GRID) {
        const v = value(set(t))
        if (v > best + 1e-9) {
          best = v
          bestT = t
          improved = true
        }
      }
      let lo = Math.max(0, bestT - 0.15)
      let hi = Math.min(TARIFF_MAX, bestT + 0.15)
      for (let i = 0; i < 12; i++) {
        const m1 = lo + (hi - lo) * 0.382
        const m2 = lo + (hi - lo) * 0.618
        if (value(set(m1)) >= value(set(m2))) hi = m2
        else lo = m1
      }
      const mid = (lo + hi) / 2
      const vm = value(set(mid))
      if (vm > best + 1e-9) {
        best = vm
        bestT = mid
        improved = true
      }
      current = set(bestT)
    }
    if (!improved) break
  }
  return current
}

export interface NashResult {
  policies: Record<CountryId, Policy>
  results: QuarterResult[]
  scores: Record<CountryId, number>
  rounds: number
  converged: boolean
}

export function nashEquilibrium(world: World, start: Record<CountryId, Policy>, spec: BaselineSpec, maxRounds = 25): NashResult {
  let policies = { A: clonePolicy(start.A), B: clonePolicy(start.B) }
  let converged = false
  let rounds = 0
  for (; rounds < maxRounds; rounds++) {
    let change = 0
    for (const c of COUNTRIES) {
      const br = bestResponse(world, policies, c, spec)
      for (let g = 0; g < N_GOODS; g++) change = Math.max(change, Math.abs(br.tariffs[g] - policies[c].tariffs[g]))
      policies = { ...policies, [c]: br }
    }
    if (change < 0.005) {
      converged = true
      rounds++
      break
    }
  }
  const results = simulateConstant(world, policies, spec.horizon)
  return {
    policies,
    results,
    scores: {
      A: objectiveScore(results, 'A', spec.objectives.A, spec.horizon <= 1),
      B: objectiveScore(results, 'B', spec.objectives.B, spec.horizon <= 1),
    },
    rounds,
    converged,
  }
}

export interface Benchmark {
  label: string
  policies: Record<CountryId, Policy>
  results: QuarterResult[]
  scores: Record<CountryId, number>
}

export function freeTradeBenchmark(world: World, spec: BaselineSpec): Benchmark {
  const policies = { A: freeTradePolicy(), B: freeTradePolicy() }
  const results = simulateConstant(world, policies, spec.horizon)
  return {
    label: '자유무역',
    policies,
    results,
    scores: {
      A: objectiveScore(results, 'A', spec.objectives.A, spec.horizon <= 1),
      B: objectiveScore(results, 'B', spec.objectives.B, spec.horizon <= 1),
    },
  }
}

// AI 결과가 자유무역(협력)과 내시(무역전쟁) 사이 어디에 있는지: 1 = 자유무역 수준, 0 = 내시 수준
export function cooperationIndex(value: number, freeTrade: number, nash: number): number {
  const span = freeTrade - nash
  if (Math.abs(span) < 1e-9) return NaN
  return (value - nash) / span
}

