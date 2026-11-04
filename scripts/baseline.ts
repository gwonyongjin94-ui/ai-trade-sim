// 이론 기준선 계산 (무료, API 호출 없음)
//   npm run baseline
// 결과: src/data/baseline.json (화면·보고서가 읽는 기준선), reports/baseline.md (설명)

import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { GOODS } from '../src/engine/goods'
import { freeTradeBenchmark, nashEquilibrium, simulateConstant } from '../src/engine/nash'
import type { BaselineSpec } from '../src/engine/nash'
import { CAPITAL_WEIGHT, objectiveScore } from '../src/engine/objectives'
import type { ObjectiveKind } from '../src/engine/objectives'
import { ENGINE } from '../src/engine/params'
import type { CountryId, Policy } from '../src/engine/types'
import { createWorld, evaluateQuarter, statusQuoPolicy } from '../src/engine/world'
import type { BaselineData, BenchmarkPath } from '../src/sim/baseline'
import { comboKey } from '../src/sim/baseline'
import { DEFAULT_CONFIG } from '../src/sim/types'

const ROOT = resolve(import.meta.dirname, '..')
const YEARS = DEFAULT_CONFIG.years
const TERM = DEFAULT_CONFIG.termYears * 4
const world = createWorld()
const combos: Record<CountryId, ObjectiveKind>[] = [
  { A: 'absolute', B: 'absolute' },
  { A: 'relative', B: 'relative' },
  { A: 'absolute', B: 'relative' },
  { A: 'relative', B: 'absolute' },
]

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length

// 정책을 게임 전체(12년) 동안 고정했을 때의 경로와 임기별 점수
function path(label: string, policies: Record<CountryId, Policy>, extra: Partial<BenchmarkPath> = {}): BenchmarkPath {
  const results = simulateConstant(world, policies, YEARS * 4)
  const termScores = (kind: ObjectiveKind, c: CountryId) =>
    Array.from({ length: YEARS / DEFAULT_CONFIG.termYears }, (_, t) => objectiveScore(results.slice(t * TERM, (t + 1) * TERM), c, kind))
  const per = (c: CountryId) => ({
    livingStandard: results.map((r) => r.indicators[c].livingStandard),
    realGdp: results.map((r) => r.indicators[c].realGdp),
    avgTariff: results.map((r) => r.indicators[c].avgTariff),
    shortage: results.map((r) => r.indicators[c].shortage),
    capital: results.map((r) => r.indicators[c].capital),
    termLs: Array.from({ length: YEARS / DEFAULT_CONFIG.termYears }, (_, t) => mean(results.slice(t * TERM, (t + 1) * TERM).map((r) => r.indicators[c].livingStandard))),
    termScores: { absolute: termScores('absolute', c), relative: termScores('relative', c) },
  })
  return { label, policies, A: per('A'), B: per('B'), ...extra }
}

const fmt = (x: number, d = 1) => x.toFixed(d)
const pct = (x: number) => `${(x * 100).toFixed(0)}%`

const data: BaselineData = {
  generatedAt: new Date().toISOString(),
  years: YEARS,
  termQuarters: TERM,
  freeTrade: path('자유무역', freeTradeBenchmark(world, { horizon: 1, objectives: combos[0], groups: 'good' }).policies),
  statusQuo: path('현상 유지 (관세 5%)', { A: statusQuoPolicy(), B: statusQuoPolicy() }),
  nash: {},
}

const md: string[] = []
md.push('# 이론 기준선', '')
md.push(`생성: ${data.generatedAt}. 엔진의 시장 수식을 그대로 써서 계산했다. API 호출 없음.`, '')
md.push('- **정적 내시**: 시작 상태에서 한 기간 균형만 본다. 자본은 산업에 묶여 있고 노동은 완전히 옮겨간다(장기). 물품별 관세, 후생 = 소비 + 투자. Johnson(1953)·Ossa(2014)와 비교하는 틀.')
md.push(`- **동적 내시**: 정책을 고정한 채 한 임기(16분기)를 게임과 같은 엔진으로 돌려 임기 목표로 평가한다. 노동은 분기마다 ${pct(ENGINE.laborMobility)}씩 옮겨가고 자본도 쌓인다. 계산량 때문에 관세는 분류(필수재·소비재·자본재)별로 묶는다.`)
md.push('- 수출 통제와 투자율은 내시 계산에서 고정(통제 없음, 22%)했다. 관세만 전략 변수다.')
md.push('- 경로는 그 정책을 게임 전체 12년 동안 고정했을 때의 결과다.', '')

for (const objectives of combos) {
  const key = comboKey(objectives)
  const entry: BaselineData['nash'][string] = {}
  for (const [kind, spec] of [
    ['static', { horizon: 1, objectives, groups: 'good' }],
    ['dynamic', { horizon: TERM, objectives, groups: 'category' }],
  ] as [('static' | 'dynamic'), BaselineSpec][]) {
    const t = performance.now()
    const n = nashEquilibrium(world, { A: statusQuoPolicy(), B: statusQuoPolicy() }, spec)
    const seconds = (performance.now() - t) / 1000
    entry[kind] = path(`${kind === 'static' ? '정적' : '동적'} 내시 (${key})`, n.policies, { converged: n.converged, rounds: n.rounds })
    console.log(`${key} ${kind}: ${seconds.toFixed(1)}s rounds=${n.rounds} converged=${n.converged}`)
  }
  data.nash[key] = entry
}

// ── 보고서 ──
const ft = data.freeTrade
md.push('## 내시 균형 관세', '')
md.push('| 목표 (A/B) | 종류 | 수렴 | A국 관세 (물품별) | B국 관세 (물품별) | A 평균 | B 평균 |')
md.push('|---|---|---|---|---|---|---|')
for (const [key, entry] of Object.entries(data.nash)) {
  for (const kind of ['static', 'dynamic'] as const) {
    const p = entry[kind]!
    const t = (c: CountryId) => p.policies[c].tariffs.map((x) => (x * 100).toFixed(0)).join(' / ')
    md.push(`| ${key} | ${kind === 'static' ? '정적' : '동적'} | ${p.converged ? '예' : `아니오 (${p.rounds}회)`} | ${t('A')} | ${t('B')} | ${pct(mean(p.policies.A.tariffs))} | ${pct(mean(p.policies.B.tariffs))} |`)
  }
}
md.push('', `물품 순서: ${GOODS.map((g) => g.name).join(' / ')}`, '')

md.push('## 1임기(16분기) 결과: 자유무역 대비', '')
md.push('생활수준은 임기 평균, 자본·GDP는 16분기 말. 절대 이익 점수 = 생활수준 + 0.3 × (자본 − 100).', '')
md.push('| 기준선 | A 생활수준 | B 생활수준 | A 자본 | B 자본 | A 절대 이익 점수 | B 절대 이익 점수 | A GDP | B GDP | A 상대 GDP 비율 | 양국 생활수준 손실 (자유무역 대비) |')
md.push('|---|---|---|---|---|---|---|---|---|---|---|')
const row = (p: BenchmarkPath) => {
  const ls = (c: CountryId) => p[c].termLs[0]
  const loss = (c: CountryId) => `${c} ${fmt((100 * (ls(c) - ft[c].termLs[0])) / ft[c].termLs[0], 2)}%`
  md.push(`| ${p.label} | ${fmt(ls('A'))} | ${fmt(ls('B'))} | ${fmt(p.A.capital[TERM - 1])} | ${fmt(p.B.capital[TERM - 1])} | ${fmt(p.A.termScores.absolute[0])} | ${fmt(p.B.termScores.absolute[0])} | ${fmt(p.A.realGdp[TERM - 1])} | ${fmt(p.B.realGdp[TERM - 1])} | ${fmt(p.A.termScores.relative[0])} | ${loss('A')}, ${loss('B')} |`)
}
row(ft)
row(data.statusQuo)
for (const entry of Object.values(data.nash)) {
  row(entry.static!)
  row(entry.dynamic!)
}
md.push('')

// Johnson·Ossa 비교. Ossa는 현실 관세 대비 후생 변화를 보고하므로 현상 유지(관세 5%)와 비교한다
const sAA = data.nash['AA'].static!
const welfareAt = (p: Record<CountryId, Policy>) => evaluateQuarter(world, p, ENGINE.staticLaborMobility).indicators
const sqW = welfareAt({ A: statusQuoPolicy(), B: statusQuoPolicy() })
const nashW = welfareAt(sAA.policies)
const freeW = welfareAt(ft.policies)
const dW = (w: typeof sqW, c: CountryId) => w[c].welfare - sqW[c].welfare
md.push('## 선행연구와 비교 (정적 내시, 양국 절대 이익)', '')
md.push('정적 비교의 후생 = 생활수준을 반영한 소비 + 실질 투자 (Ossa의 실질소득에 해당). 현상 유지(관세 5%) 대비 변화.', '')
md.push('| | 이 모형 | Ossa (2014) |')
md.push('|---|---|---|')
md.push(`| 평균 내시 관세 | ${pct(mean([...sAA.policies.A.tariffs, ...sAA.policies.B.tariffs]))} (A ${pct(mean(sAA.policies.A.tariffs))}, B ${pct(mean(sAA.policies.B.tariffs))}) | 약 63% |`)
md.push(`| 후생 변화 (무역전쟁) | 평균 ${fmt((dW(nashW, 'A') + dW(nashW, 'B')) / 2, 2)}% (A ${fmt(dW(nashW, 'A'), 2)}%, B ${fmt(dW(nashW, 'B'), 2)}%) | 평균 −2.9% |`)
md.push(`| 후생 변화 (자유무역) | A ${fmt(dW(freeW, 'A'), 2)}%, B ${fmt(dW(freeW, 'B'), 2)}% | |`)
md.push(`| 시작 시 무역 개방도 (수출+수입)/GDP | A ${pct(sqW.A.tradeOpenness)}, B ${pct(sqW.B.tradeOpenness)} | |`)
md.push('')
md.push('보정 방법과 후보 비교는 reports/calibration.md. 주요 변경: 노동이 가격에 반응해 산업 사이를 옮겨가게 했고(공급 탄력성), 자국 편향·대체탄력성·생산성 격차를 격자 탐색으로 맞췄다.', '')
md.push('Armington형 모형에서 물품 하나만 떼어 보면 최적 관세는 대략 1/(σ−1) 근처다 (Gros 1987). 두 나라 일반균형에서는 무역수지 균형 때문에 관세들이 함께 교역조건 전체를 움직이므로 물품별 값은 이 근사에서 벗어난다. Ossa와 비교하는 것은 평균이다.', '')
md.push('| 물품 | σ | 1/(σ−1) | A 정적 내시 | B 정적 내시 | A 수입 의존도 (시작) |')
md.push('|---|---|---|---|---|---|')
GOODS.forEach((g, i) => {
  const s = g.substitutionElasticity
  md.push(`| ${g.name} | ${fmt(s, 2)} | ${pct(1 / (s - 1))} | ${pct(sAA.policies.A.tariffs[i])} | ${pct(sAA.policies.B.tariffs[i])} | ${pct(sqW.A.importDependence[i])} |`)
})
md.push('')
md.push(`동적 내시는 게임의 목표로 계산한다. 절대 이익 점수에는 임기 말 자본이 들어간다 (가중치 ${CAPITAL_WEIGHT}: 자본 1%가 다음 임기 생활수준을 약 ${CAPITAL_WEIGHT} 올리는 효과). 넣기 전에는 투자 감소 비용이 임기 안에서 덜 보여 자본재 관세가 200% 가까이 붙었다.`)
md.push('관세 상한은 200%다.', '')

mkdirSync(resolve(ROOT, 'src/data'), { recursive: true })
mkdirSync(resolve(ROOT, 'reports'), { recursive: true })
writeFileSync(resolve(ROOT, 'src/data/baseline.json'), JSON.stringify(data))
writeFileSync(resolve(ROOT, 'reports/baseline.md'), md.join('\n') + '\n')
console.log('wrote src/data/baseline.json, reports/baseline.md')
