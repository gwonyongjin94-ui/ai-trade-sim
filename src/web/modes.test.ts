// 관세·정책 실험·리플레이 모드의 자료가 엔진·원자료와 맞는지 확인한다
import { describe, expect, it } from 'vitest'
import trade from '../../data/v2/trade-2023.json'
import tariffsJson from '../../data/v2/tariffs.json'
import { BLOCS, REGIONS } from '../v2/regions'
import { HOME, josa, MEMBERS, regionOf } from './blocs'
import { DATA } from './data'
import type { ReplayFile, ReplayIndexEntry } from './replay/types'
import { decodeChanges, encodeChanges, policiesAt, PRESETS, simulate, type Change } from './sim/scenario'
import { avgTariffPct, tariffPct } from './tariffs'

const REPLAYS = import.meta.glob<ReplayFile>('/public/replays/*.json', { eager: true, import: 'default' })
const INDEX = REPLAYS['/public/replays/index.json'] as unknown as ReplayIndexEntry[]
const replay = (id: string) => REPLAYS[`/public/replays/${id}.json`]
const preset = (id: string) => PRESETS.find((p) => p.id === id)!.changes

describe('블록과 지도', () => {
  it('블록 회원국이 v2 교역 자료의 블록 정의와 같고, 모두 지도 나라다', () => {
    const blocs = (trade as unknown as { meta: { blocs: Record<string, { members: { iso: string; optional?: boolean }[] }> } }).meta.blocs
    for (const b of BLOCS) {
      expect(MEMBERS[b].slice().sort(), b).toEqual(blocs[b].members.filter((m) => !m.optional).map((m) => m.iso).sort())
      for (const iso of MEMBERS[b]) expect(DATA.countries[iso], iso).toBeDefined()
      expect(MEMBERS[b]).toContain(HOME[b])
    }
    expect(regionOf('DEU')).toBe('R')
    expect(regionOf('TUR')).toBe('R') // v2에서 빠진 선택 회원국
    expect(regionOf('HKG')).toBe('B')
  })

  it('조사', () => {
    expect(josa('대한민국', '이', '가')).toBe('대한민국이')
    expect(josa('나머지 세계', '이', '가')).toBe('나머지 세계가')
    expect(josa('일본', '은', '는')).toBe('일본은')
  })
})

describe('관세', () => {
  it('엔진의 시작 관세 = 수집한 블록 관세 (0.1%p 반올림)', () => {
    const bloc = (tariffsJson as unknown as { bloc: Record<string, Record<string, Record<string, number>>> }).bloc
    expect(tariffPct('A', 'B', 'food')).toBeCloseTo(bloc.A.B.food * 100, 0)
    expect(tariffPct('E', 'B', 'machinery')).toBeCloseTo(bloc.E.B.machinery * 100, 0)
    expect(tariffPct('A', 'A', 'food')).toBeNull()
  })

  it('미중 관세는 무역전쟁 덧씌우기 수준이고, 평균은 물품 관세 범위 안에 있다', () => {
    // PIIE: 미국의 대중국 평균 19.3%, 중국의 대미국 21% (수입액 가중, 나라 쌍 기준). 블록 평균이라 홍콩·캐나다·멕시코가 섞여 조금 낮다
    expect(avgTariffPct('E', 'B')!).toBeGreaterThan(10)
    expect(avgTariffPct('B', 'E')!).toBeGreaterThan(10)
    for (const i of REGIONS)
      for (const j of REGIONS) {
        if (i === j) continue
        const v = avgTariffPct(i, j)!
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThan(100)
      }
  })
})

describe('정책 실험', () => {
  it('준비된 시나리오의 정책: 도발은 3분기부터 미국→중국 +25%p', () => {
    const before = policiesAt(preset('provoke'), 1)
    const after = policiesAt(preset('provoke'), 2)
    const base = policiesAt([], 2)
    expect(before.E.tariffs.B).toEqual(base.E.tariffs.B)
    after.E.tariffs.B.forEach((t, g) => expect(t).toBeCloseTo(base.E.tariffs.B[g] + 0.25, 9))
    expect(after.E.tariffs.A).toEqual(base.E.tariffs.A)
    const free = policiesAt(preset('free'), 0)
    for (const a of BLOCS) for (const b of BLOCS) if (a !== b) expect(Math.max(...free[a].tariffs[b])).toBe(0)
    expect(free.A.tariffs.R).toEqual(base.A.tariffs.R) // 나머지 세계와의 관세는 그대로
  })

  it('주소에 담은 변경 목록을 그대로 되살린다', () => {
    const cs: Change[] = [
      { kind: 'tariffAdd', actor: 'E', partner: 'B', good: 'all', value: 25, from: 2 },
      { kind: 'control', actor: 'B', partner: 'E', good: 'semiconductors', value: 3, from: 5 },
      { kind: 'invest', actor: 'A', partner: 'all', good: 'all', value: 30.5, from: 0 },
      { kind: 'tariffSet', actor: 'F', partner: 'all', good: 'apparel_household', value: 12.5, from: 15 },
    ]
    expect(decodeChanges(encodeChanges(cs))).toEqual(cs)
    expect(decodeChanges('망가진값')).toEqual([])
  })

  // 브라우저(Web Worker)가 돌리는 simulate()가 게임 엔진의 기록과 같은지: 같은 정책을 낸 규칙 지도자 기록과 맞춘다
  it.each([
    ['rule-provoke-sq', 'provoke'],
    ['rule-provoke-tft', 'tradewar'],
    ['rule-free', 'free'],
  ])('리플레이 %s = 정책 실험 %s', (rid, pid) => {
    const r = replay(rid)
    const sim = simulate(preset(pid))
    expect(sim).toHaveLength(r.quarters.length)
    for (const q of r.quarters)
      for (const reg of REGIONS) {
        expect(sim[q.q].regions[reg].livingStandard, `${reg} q${q.q}`).toBeCloseTo(q.ind[reg].livingStandard, 3)
        expect(sim[q.q].regions[reg].realGdp, `${reg} q${q.q}`).toBeCloseTo(q.ind[reg].realGdp, 3)
        expect(sim[q.q].regions[reg].exports).toBeCloseTo(q.ind[reg].exports, 1)
      }
    for (const b of BLOCS) expect(sim[15].ratio[b]).toBeCloseTo(r.quarters[15].ratio[b], 3)
  }, 20_000)
})

describe('AI 리플레이 파일', () => {
  it('목록의 파일이 모두 있고, 16분기·6개국 기록이다', () => {
    expect(INDEX.length).toBeGreaterThan(0)
    for (const e of INDEX) {
      const r = replay(e.id)
      expect(r, e.id).toBeDefined()
      expect(r.kind).toBe(e.kind)
      expect(r.quarters).toHaveLength(e.quarters)
      for (const q of r.quarters) expect(Object.keys(q.blocs).sort()).toEqual([...BLOCS])
    }
  })

  it('도발 + 팃포탯: 미국이 3분기에 중국에 +120, 중국이 4분기에 그대로 보복', () => {
    const r = replay('rule-provoke-tft')
    expect(r.quarters[2].es).toEqual([expect.objectContaining({ from: 'E', to: 'B', score: 120 })])
    expect(r.quarters[3].es).toEqual([expect.objectContaining({ from: 'B', to: 'E', score: 120 })])
    expect(r.totals.actors.B.retaliationRate).toBe(1)
    expect(r.totals.actors.A.given).toBe(0)
  })
})
