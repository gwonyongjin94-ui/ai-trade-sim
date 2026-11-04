import { describe, expect, it } from 'vitest'
import { checkCompliance, commitmentsFromProposal, sanitizeProposal } from './diplomacy'
import { CULTURE } from './culture'
import { GOODS, goodIndex } from './goods'
import { scoreActions, sumScore } from './hostility'
import { nashEquilibrium, simulateConstant } from './nash'
import { CAPITAL_WEIGHT, objectiveScore } from './objectives'
import { ENGINE } from './params'
import type { Policy } from './types'
import { clonePolicy, createWorld, DEFAULT_PARAMS, evaluateQuarter, freeTradePolicy, statusQuoPolicy } from './world'

const world = createWorld()
const sq = () => ({ A: statusQuoPolicy(), B: statusQuoPolicy() })
const worldWelfare = (p: { A: Policy; B: Policy }) => {
  const { indicators } = evaluateQuarter(world, p)
  const { A, B } = DEFAULT_PARAMS
  return (A.population * indicators.A.livingStandard + B.population * indicators.B.livingStandard) / (A.population + B.population)
}

describe('시장', () => {
  it('시작 상태에서 시장이 청산되고 생활수준 지수가 100이다', () => {
    const { market, indicators } = evaluateQuarter(world, sq())
    expect(market.converged).toBe(true)
    expect(market.maxExcess).toBeLessThan(1e-6)
    expect(indicators.A.livingStandard).toBeCloseTo(100, 1)
    expect(indicators.B.livingStandard).toBeCloseTo(100, 1)
  })

  it('양국이 서로 100% 관세를 매기면 세계 후생이 자유무역보다 낮다', () => {
    const war = (): Policy => ({ ...freeTradePolicy(), tariffs: freeTradePolicy().tariffs.map(() => 1) })
    expect(worldWelfare({ A: war(), B: war() })).toBeLessThan(worldWelfare({ A: freeTradePolicy(), B: freeTradePolicy() }) - 1)
  })

  it('B가 에너지 수출을 금지하면 A에 필수재 부족이 생긴다', () => {
    const p = sq()
    p.B.exportControls[goodIndex('energy')] = 3
    const { indicators, market } = evaluateQuarter(world, p)
    expect(market.converged).toBe(true)
    expect(indicators.A.shortageByGood[goodIndex('energy')]).toBeGreaterThan(0)
    expect(indicators.A.livingStandard).toBeLessThan(95)
    expect(indicators.A.inflation).toBeGreaterThan(0) // 에너지값이 뛰어 물가가 오른다
  })

  it('현상 유지면 물가 상승률이 0 근처다 (시작이 정상상태)', () => {
    const { indicators } = evaluateQuarter(world, sq())
    for (const c of ['A', 'B'] as const) expect(Math.abs(indicators[c].inflation)).toBeLessThan(0.001)
  })
})

describe('보정', () => {
  // Ossa(2014): 평균 내시 관세 약 63%, 현실 관세 대비 후생 −2.9%. reports/calibration.md
  it('정적 내시(양국 절대 이익)가 Ossa 수준에 있다', () => {
    const nash = nashEquilibrium(world, sq(), { horizon: 1, objectives: { A: 'absolute', B: 'absolute' }, groups: 'good' })
    const tariffs = [...nash.policies.A.tariffs, ...nash.policies.B.tariffs]
    const mean = tariffs.reduce((s, x) => s + x, 0) / tariffs.length
    const start = evaluateQuarter(world, sq(), ENGINE.staticLaborMobility).indicators
    const w = nash.results[0].indicators
    const loss = (w.A.welfare - start.A.welfare + w.B.welfare - start.B.welfare) / 2
    expect(nash.converged).toBe(true)
    expect(mean).toBeGreaterThan(0.5)
    expect(mean).toBeLessThan(0.8)
    expect(loss).toBeGreaterThan(-4.5)
    expect(loss).toBeLessThan(-1.5)
  }, 60_000)
})

describe('외교', () => {
  it('제안 값을 범위 안으로 고치고 없는 물품은 뺀다', () => {
    const p = sanitizeProposal(
      { terms: [{ obligor: 'both', kind: 'tariff_max', goods: ['grain', 'nonsense' as never], value: 500 }], durationQuarters: 40, note: '' },
      'A',
      2,
      0,
    )!
    expect(p.id).toBe('A3-1')
    expect(p.terms[0].goods).toEqual(['grain'])
    expect(p.terms[0].value).toBe(200)
    expect(p.durationQuarters).toBe(16)
  })

  it('약속은 다음 분기부터 적용되고 첫 위반만 first로 표시된다', () => {
    const p = sanitizeProposal({ terms: [{ obligor: 'counterpart', kind: 'tariff_max', goods: ['all'], value: 5 }], durationQuarters: 4, note: '' }, 'A', 0, 0)!
    const cms = commitmentsFromProposal(p, 0)
    expect(cms).toHaveLength(1)
    expect(cms[0].obligor).toBe('B')
    expect(cms[0].startQuarter).toBe(1)
    const pol = sq()
    pol.B.tariffs[0] = 0.3
    const seen = new Set<string>()
    expect(checkCompliance(cms, pol, 0, seen)).toHaveLength(0) // 아직 시작 전
    const v1 = checkCompliance(cms, pol, 1, seen)
    expect(v1).toHaveLength(1)
    expect(v1[0].first).toBe(true)
    expect(v1[0].breaches[0]).toMatchObject({ good: 'grain', actual: 30, limit: 5 })
    expect(checkCompliance(cms, pol, 2, seen)[0].first).toBe(false)
  })
})

describe('확전점수 (Rivera 가중치)', () => {
  it('관세 인상·인하와 필수재 금수에 정해진 점수를 준다', () => {
    const before = statusQuoPolicy()
    const hike = clonePolicy(before)
    hike.tariffs[goodIndex('appliances')] = 0.2
    expect(sumScore(scoreActions({ before, after: hike, tone: 'neutral', acceptedProposals: 0, newViolations: 0 }))).toBe(12)
    const cut = clonePolicy(before)
    cut.tariffs[goodIndex('appliances')] = 0
    expect(sumScore(scoreActions({ before, after: cut, tone: 'neutral', acceptedProposals: 0, newViolations: 0 }))).toBe(-2)
    const ban = clonePolicy(before)
    ban.exportControls[goodIndex('grain')] = 3
    expect(sumScore(scoreActions({ before, after: ban, tone: 'threat', acceptedProposals: 0, newViolations: 0 }))).toBe(64)
  })
})

describe('목표 점수', () => {
  it('절대 이익은 생활수준 평균 + 임기 말 자본 항, 상대 이익은 GDP 비율이다', () => {
    const { market, indicators } = evaluateQuarter(world, sq())
    const r = [{ quarter: 0, market, indicators, policies: sq() }]
    expect(indicators.A.capital).toBeCloseTo(100, 3)
    expect(objectiveScore(r, 'A', 'absolute')).toBeCloseTo(indicators.A.livingStandard)
    expect(objectiveScore(r, 'A', 'relative')).toBeCloseTo((100 * indicators.A.realGdp) / indicators.B.realGdp)
    const richer = [{ ...r[0], indicators: { ...indicators, A: { ...indicators.A, capital: 110 } } }]
    expect(objectiveScore(richer, 'A', 'absolute')).toBeCloseTo(indicators.A.livingStandard + 10 * CAPITAL_WEIGHT)
  })

  it('투자율을 낮추면 임기 생활수준은 오르지만 자본 항이 그 이득을 깎는다', () => {
    const low = { A: { ...statusQuoPolicy(), investmentRate: 0.1 }, B: statusQuoPolicy() }
    const run = (p: { A: Policy; B: Policy }) => simulateConstant(world, p, 16)
    const ls = (rs: ReturnType<typeof run>) => rs.reduce((s, q) => s + q.indicators.A.livingStandard, 0) / rs.length
    const [base, cut] = [run(sq()), run(low)]
    expect(ls(cut)).toBeGreaterThan(ls(base))
    expect(cut[15].indicators.A.capital).toBeLessThan(95)
    expect(objectiveScore(cut, 'A', 'absolute') - objectiveScore(base, 'A', 'absolute')).toBeLessThan(ls(cut) - ls(base))
  })
})

describe('문화 차이', () => {
  it('나라별 지출 비중이 소비·투자 예산마다 합 1이고, 취향이 다르다', () => {
    for (const c of ['A', 'B'] as const) {
      const sum = (cat: (g: (typeof GOODS)[number]) => boolean) => GOODS.filter(cat).reduce((s, g) => s + g.baseShare[c], 0)
      expect(sum((g) => g.category !== 'capital')).toBeCloseTo(1, 9)
      expect(sum((g) => g.category === 'capital')).toBeCloseTo(1, 9)
    }
    expect(GOODS[goodIndex('grain')].baseShare.B).toBeGreaterThan(GOODS[goodIndex('grain')].baseShare.A)
  })

  it('노동 인구는 인구 × 경제활동참가율이다', () => {
    expect(DEFAULT_PARAMS.A.labor).toBeCloseTo(50 * CULTURE.A.participation)
    expect(DEFAULT_PARAMS.B.labor).toBeCloseTo(70 * CULTURE.B.participation)
    expect(CULTURE.A.participation).not.toBe(CULTURE.B.participation)
  })
})
