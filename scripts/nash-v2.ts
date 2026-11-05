// v2 이론 기준선 (무료, API 호출 없음): 6개국 정적 내시 균형 관세
//   npm run nash:v2
// 결과: src/data/v2-nash.json (보고서가 읽는다), 화면에 요약
//
// v1 정적 내시(src/engine/nash.ts)와 같은 틀이다. 자본은 시작 상태에 고정, 노동은 완전히 옮겨간 한 기간 균형 (Johnson 1953, Ossa 2014).
//  - 각 AI 블록은 상대 5개국마다 관세 하나(10개 물품에 같은 값, 0~200%)를 고른다 → 6 × 5 = 30개 변수
//  - 수출 통제는 2023년 값(미국 → 중국 반도체 1단계), 투자율은 2023년 값, 나머지 세계와의 정책은 고정
//  - 절대 이익: 정적 후생 지수(생활수준을 반영한 소비 + 실질 투자, 시작 = 100). 상대 이익: 명목 GDP 비율
//  - 다른 나라 관세를 주어진 것으로 보고 상대마다 격자 탐색 + 황금분할로 최적 대응을 찾고, 6개국을 돌아가며 수렴할 때까지 반복한다
// 물품별로 다른 관세는 고르지 않으므로 물품별 최적 관세보다 낮게 잡힐 수 있다 (v1에서 물품별 / 범주별 차이는 작았다).

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { ENGINE } from '../src/engine/params'
import { nominalRatio } from '../src/v2/objectives'
import type { ObjectiveKind } from '../src/v2/objectives'
import { avgTariffPct } from '../src/v2/policy'
import { BLOCS, regionName } from '../src/v2/regions'
import type { BlocId, RegionId } from '../src/v2/regions'
import { TARIFF_MAX } from '../src/v2/types'
import type { Indicators, Policy } from '../src/v2/types'
import { clonePolicy, createWorld, evaluateQuarter, statusQuoPolicies } from '../src/v2/world'

const ROOT = resolve(import.meta.dirname, '..')
const OUT = resolve(ROOT, 'src/data/v2-nash.json')
const world = createWorld()
const BASE = statusQuoPolicies()
const others = (i: BlocId) => BLOCS.filter((b) => b !== i)
const GRID = [0, 0.05, 0.1, 0.2, 0.3, 0.5, 0.75, 1, 1.5, 2]
let evals = 0

function evaluate(p: Record<RegionId, Policy>): Record<RegionId, Indicators> {
  evals++
  return evaluateQuarter(world, p, ENGINE.staticLaborMobility).indicators
}

const objective = (ind: Record<RegionId, Indicators>, i: BlocId, kind: ObjectiveKind) => (kind === 'absolute' ? ind[i].welfare : nominalRatio(ind, i))

function setTariff(p: Record<RegionId, Policy>, i: BlocId, j: BlocId, t: number): Record<RegionId, Policy> {
  const q = { ...p, [i]: clonePolicy(p[i]) }
  q[i].tariffs[j] = q[i].tariffs[j].map(() => t)
  return q
}

// i의 j에 대한 관세 하나의 최적 대응 (나머지는 고정)
function bestTariff(p: Record<RegionId, Policy>, i: BlocId, j: BlocId, kind: ObjectiveKind): number {
  const value = (t: number) => objective(evaluate(setTariff(p, i, j, t)), i, kind)
  let bestT = GRID[0]
  let best = -Infinity
  for (const t of GRID) {
    const v = value(t)
    if (v > best) {
      best = v
      bestT = t
    }
  }
  let lo = Math.max(0, bestT - 0.15)
  let hi = Math.min(TARIFF_MAX, bestT + 0.15)
  for (let k = 0; k < 10; k++) {
    const m1 = lo + (hi - lo) * 0.382
    const m2 = lo + (hi - lo) * 0.618
    if (value(m1) >= value(m2)) hi = m2
    else lo = m1
  }
  const mid = (lo + hi) / 2
  return value(mid) > best ? mid : bestT
}

interface Outcome {
  tariffsPct: Record<BlocId, Partial<Record<BlocId, number>>> // 행: 관세를 매기는 나라, 열: 상대 (10개 물품 평균 %)
  welfare: Record<BlocId, number>
  livingStandard: Record<BlocId, number>
  ratio: Record<BlocId, number>
  nominalGdpUsd: Record<BlocId, number>
}

function outcome(p: Record<RegionId, Policy>): Outcome {
  const ind = evaluate(p)
  const per = <T>(f: (b: BlocId) => T) => Object.fromEntries(BLOCS.map((b) => [b, f(b)])) as Record<BlocId, T>
  return {
    tariffsPct: per((i) => Object.fromEntries(others(i).map((j) => [j, Math.round(avgTariffPct(p[i], j) * 10) / 10]))),
    welfare: per((b) => ind[b].welfare),
    livingStandard: per((b) => ind[b].livingStandard),
    ratio: per((b) => nominalRatio(ind, b)),
    nominalGdpUsd: per((b) => ind[b].nominalGdpUsd),
  }
}

function nash(kind: ObjectiveKind, maxRounds = 15) {
  let p: Record<RegionId, Policy> = { ...BASE }
  let rounds = 0
  let converged = false
  const t0 = performance.now()
  for (; rounds < maxRounds; rounds++) {
    let change = 0
    for (const i of BLOCS) {
      for (const j of others(i)) {
        const before = avgTariffPct(p[i], j) / 100
        const t = bestTariff(p, i, j, kind)
        change = Math.max(change, Math.abs(t - before))
        p = setTariff(p, i, j, t)
      }
    }
    console.log(`  ${kind} ${rounds + 1}회차: 최대 변화 ${(change * 100).toFixed(2)}%p (${((performance.now() - t0) / 1000).toFixed(0)}초, 평가 ${evals}회)`)
    if (change < 0.005) {
      converged = true
      rounds++
      break
    }
  }
  return { ...outcome(p), rounds, converged }
}

const freeTrade: Record<RegionId, Policy> = { ...BASE }
for (const i of BLOCS) for (const j of others(i)) Object.assign(freeTrade, setTariff(freeTrade, i, j, 0))

console.log('현상 유지·자유무역 계산')
const statusQuo = outcome(BASE)
const free = outcome(freeTrade)
console.log('정적 내시 (절대 이익: 후생)')
const nashAbs = nash('absolute')
console.log('정적 내시 (상대 이익: 명목 GDP 비율)')
const nashRel = nash('relative')

const data = {
  computedAt: new Date().toISOString(),
  method:
    '정적 (자본 고정, 노동 완전 이동). 상대국마다 10개 물품 같은 관세 하나. 수출 통제·투자율·나머지 세계 정책은 2023년 값. 절대 이익 = 후생 지수, 상대 이익 = 명목 GDP 비율',
  statusQuo,
  freeTrade: free,
  nash: { absolute: nashAbs, relative: nashRel },
}
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(data, null, 2))

const name = (b: BlocId) => regionName(b, 'real')
const f = (x: number, d = 1) => x.toFixed(d)
for (const [label, r] of [
  ['절대 이익', nashAbs],
  ['상대 이익', nashRel],
] as const) {
  console.log(`\n## 정적 내시: ${label} (${r.converged ? `${r.rounds}회차에 수렴` : '수렴 안 함'})`)
  console.log(`관세 (행이 상대에게 매김, %) | ${BLOCS.map(name).join(' | ')}`)
  for (const i of BLOCS) console.log(`${name(i)} | ${BLOCS.map((j) => (i === j ? '-' : f(r.tariffsPct[i][j]!))).join(' | ')}`)
  console.log(`후생 | ${BLOCS.map((b) => f(r.welfare[b], 2)).join(' | ')}  (현상 유지 100, 자유무역 ${BLOCS.map((b) => f(free.welfare[b], 2)).join('/')})`)
  console.log(`명목 GDP 비율 | ${BLOCS.map((b) => f(r.ratio[b])).join(' | ')}  (현상 유지 ${BLOCS.map((b) => f(statusQuo.ratio[b])).join('/')})`)
}
console.log(`\n저장: ${OUT} (평가 ${evals}회)`)
