import { describe, expect, it } from 'vitest'
import { BASE } from './calibrate'
import { BLOCS, REGIONS } from './regions'
import type { RegionId } from './regions'
import { sectorIndex, TRADED } from './sectors'
import type { Policy } from './types'
import { createWorld, evaluateQuarter, statusQuoPolicies, stepQuarter } from './world'

const world = createWorld()
const sq = statusQuoPolicies
const start = evaluateQuarter(world, sq())
const energy = sectorIndex('energy')
const semis = sectorIndex('semiconductors')

describe('v2 시작점 (2023년 자료로 보정)', () => {
  it('2023년 정책에서 시장이 청산되고 모든 지수가 100이다', () => {
    expect(start.market.converged).toBe(true)
    expect(start.market.maxExcess).toBeLessThan(1e-6)
    for (const r of REGIONS) {
      expect(start.indicators[r].livingStandard).toBeCloseTo(100, 4)
      expect(start.indicators[r].realGdp).toBeCloseTo(100, 4)
      expect(Math.abs(start.indicators[r].inflation)).toBeLessThan(1e-6)
    }
  })

  it('지역 간 교역액이 2023년 자료와 같다', () => {
    for (const i of REGIONS)
      for (const j of REGIONS) {
        if (i === j) continue
        const data = TRADED.reduce((t, s) => t + BASE.flows[i][j][s.id], 0)
        expect(start.indicators[j].importsFrom[i] / data).toBeCloseTo(1, 6)
      }
  })

  it('실질 GDP(2023년 달러)가 자료의 GDP다', () => {
    for (const r of REGIONS) expect(start.indicators[r].realGdpUsd / BASE.data[r].gdpUsd).toBeCloseTo(1, 6)
  })

  it('현상 유지 16분기 동안 정상상태가 유지된다', () => {
    let w = world
    for (let q = 0; q < 16; q++) {
      const s = stepQuarter(w, sq())
      w = s.world
      for (const r of REGIONS) {
        expect(Math.abs(s.result.indicators[r].livingStandard - 100)).toBeLessThan(0.01)
        expect(Math.abs(s.result.indicators[r].capital - 100)).toBeLessThan(0.01)
      }
    }
  })
})

describe('v2 정책 충격', () => {
  it('중동이 한국에 에너지 수출을 금지하면 한국은 다른 공급처로 옮기고 생활수준이 떨어진다', () => {
    const p = sq()
    p.D.exportControls.A[energy] = 3
    const { market, indicators } = evaluateQuarter(world, p)
    expect(market.converged).toBe(true)
    expect(market.purchases.A.D[energy]).toBe(0)
    expect(market.purchases.A.R[energy]).toBeGreaterThan(start.market.purchases.A.R[energy] * 1.3)
    expect(market.purchases.A.E[energy]).toBeGreaterThan(start.market.purchases.A.E[energy] * 1.3)
    expect(indicators.A.livingStandard).toBeLessThan(99.8)
    expect(indicators.A.cpi).toBeGreaterThan(100)
  })

  it('미국이 중국에 반도체 수출을 금지하면 중국은 대만·한국산으로 옮긴다 (무역 전환)', () => {
    const p = sq()
    p.E.exportControls.B[semis] = 3
    const { market, indicators } = evaluateQuarter(world, p)
    expect(market.converged).toBe(true)
    expect(market.purchases.B.E[semis]).toBe(0)
    expect(market.purchases.B.F[semis]).toBeGreaterThan(start.market.purchases.B.F[semis])
    expect(market.purchases.B.A[semis]).toBeGreaterThan(start.market.purchases.B.A[semis])
    expect(indicators.B.realInvestment).toBeLessThan(start.indicators.B.realInvestment)
    expect(indicators.F.livingStandard).toBeGreaterThan(100)
  })

  it('관세는 상대국마다 따로 걸린다: 미국이 중국산에만 50%를 매기면 다른 나라에서 더 산다', () => {
    const p = sq()
    for (let g = 0; g < TRADED.length; g++) p.E.tariffs.B[g] = 0.5
    const { indicators } = evaluateQuarter(world, p)
    expect(indicators.E.importsFrom.B).toBeLessThan(0.6 * start.indicators.E.importsFrom.B)
    for (const j of ['A', 'C', 'F', 'R'] as RegionId[]) expect(indicators.E.importsFrom[j]).toBeGreaterThan(start.indicators.E.importsFrom[j])
    expect(indicators.B.livingStandard).toBeLessThan(100)
  })

  it('AI 6개국이 서로 100% 관세를 매기면 모두 후생이 떨어진다', () => {
    const p: Record<RegionId, Policy> = sq()
    for (const i of BLOCS) for (const j of BLOCS) if (i !== j) for (let g = 0; g < TRADED.length; g++) p[i].tariffs[j][g] = 1
    const { market, indicators } = evaluateQuarter(world, p)
    expect(market.converged).toBe(true)
    for (const r of BLOCS) expect(indicators[r].welfare).toBeLessThan(100)
  })

  it('투자율을 올리면 이번 분기 소비가 줄고 자본이 늘어난다', () => {
    const p = sq()
    p.A.investmentRate += 0.05
    const s = stepQuarter(world, p)
    expect(s.result.indicators.A.realConsumption).toBeLessThan(100)
    expect(s.result.indicators.A.capital).toBeGreaterThan(100)
  })
})
