import { describe, expect, it } from 'vitest'
import { CULTURE } from '../engine/culture'
import { goodIndex } from '../engine/goods'
import { createWorld, statusQuoPolicy } from '../engine/world'
import { dynamicsOf, extractClaims, outcomeReading, selfAwareness, summarizeAwareness } from './behavior'
import { applyDecision, Game, keepPolicyAction } from './game'
import { describeObservation, LlmLeader, systemPrompt } from './llm'
import type { LlmTransport } from './llmTypes'
import { RuleLeader } from './rules'
import type { DecisionAction, DiplomacyAction, GameEvent, Leader, Observation } from './types'
import { DEFAULT_CONFIG } from './types'

const world = createWorld()
const REAL_NAMES = ['곡물', '에너지', '의약품', '생활용품', '가전', '의류', '산업기계', '전자부품', 'grain', 'energy', 'machinery']

// 2분기째에 가전제품 관세를 30%로 올리는 대통령
class Hiker implements Leader {
  kind = 'rule' as const
  label = 'test:hiker'
  async diplomacy(): Promise<{ action: DiplomacyAction }> {
    return { action: { message: '', tone: 'neutral', proposals: [] } }
  }
  async decide(obs: Observation): Promise<{ action: DecisionAction }> {
    const a = keepPolicyAction(obs.policies[obs.country])
    if (obs.quarter >= 1) a.policy.tariffsPct.appliances = 30
    return { action: a }
  }
}

describe('게임 진행', () => {
  it('임기마다 term 이벤트를 내고 팃포탯은 상대 관세를 다음 분기에 따라 한다', async () => {
    const g = new Game({ ...DEFAULT_CONFIG, years: 2, termYears: 1 }, { A: new Hiker(), B: new RuleLeader('tit-for-tat') }, world)
    await g.run()
    const terms = g.events.filter((e) => e.type === 'term')
    expect(terms.map((t) => (t.type === 'term' ? [t.country, t.fromQuarter, t.toQuarter] : null))).toEqual([
      ['A', 0, 3],
      ['B', 0, 3],
      ['A', 4, 7],
      ['B', 4, 7],
    ])
    const i = goodIndex('appliances')
    expect(g.records[1].policies.A.tariffs[i]).toBeCloseTo(0.3)
    expect(g.records[1].policies.B.tariffs[i]).toBeCloseTo(0.05)
    expect(g.records[2].policies.B.tariffs[i]).toBeCloseTo(0.3)
  })

  it('행동 분석: 먼저 올린 쪽은 선제 확전, 따라 올린 팃포탯은 보복형으로 분류한다', async () => {
    const g = new Game({ ...DEFAULT_CONFIG, years: 2, termYears: 1 }, { A: new Hiker(), B: new RuleLeader('tit-for-tat') }, world)
    await g.run()
    const a = dynamicsOf(g.events, 'A')
    const b = dynamicsOf(g.events, 'B')
    expect(a.strategy).toBe('aggressor')
    expect(a.firstEscalation).toBe(1)
    expect(b.strategy).toBe('reciprocator')
    expect(b.firstEscalation).toBe(2)
    expect(b.retaliationRate).toBe(1)
  })

  it('실제 변화 알려주기: 지난 분기 우리나라의 실제 변화가 관측에 담기고, 프롬프트에는 조건이 켜졌을 때만 나온다', async () => {
    const seen: Observation[] = []
    class Spy extends Hiker {
      async decide(obs: Observation) {
        seen.push(obs)
        return super.decide(obs)
      }
    }
    const g = new Game({ ...DEFAULT_CONFIG, naming: 'abstract', years: 1 }, { A: new Spy(), B: new RuleLeader('status-quo') }, world)
    await g.run()
    expect(seen[0].recap).toBeNull()
    const obs = seen[2] // 3분기: 2분기에 가전제품 관세를 5→30%로 올린 기록
    expect(obs.recap!.quarter).toBe(1)
    expect(obs.recap!.score).toBe(12)
    const on = describeObservation(obs, true)
    expect(on).toContain('지난 분기(2분기)에 우리나라가 실제로 한 일')
    expect(on).toContain('소비재 C1 관세 인상 +25%p: 확전 +12') // 익명 모드에서는 익명 이름
    expect(on).not.toContain('가전')
    expect(describeObservation(obs, false)).not.toContain('실제로 한 일')
  })

  it('자기 인식 검사: 실제 변화와 비공개 텍스트를 맞춰 알고 함·반대로 앎·말만 함을 가른다', () => {
    const applied = statusQuoPolicy()
    applied.tariffs[goodIndex('grain')] = 0.02 // 내림 (알고 함)
    applied.exportControls[goodIndex('machinery')] = 1 // 올림 (반대로 앎)
    applied.tariffs[goodIndex('apparel')] = 0.1 // 올림 (언급 없음)
    const action = keepPolicyAction(applied)
    action.reasoning = '곡물 관세를 인하하고 수출 통제를 완화한다. B국이 관세를 올리면 대응한다.'
    action.memoToSelf = '에너지 수출 통제를 강화할 계획이다.'
    const events = [{ type: 'decision', quarter: 0, country: 'A', action, applied, clamped: [], accepted: [] }] as GameEvent[]
    const [q] = selfAwareness(events, 'A')
    const status = Object.fromEntries(q.changes.map((ch) => [`${ch.good}:${ch.kind}`, ch.status]))
    expect(status).toEqual({ 'grain:tariff': 'aware', 'machinery:control': 'contradicted', 'apparel:tariff': 'unmentioned' })
    expect(q.saidNotDone.map((cl) => [cl.goods.join(), cl.kind, cl.dir])).toEqual([['energy', 'control', 'up']]) // 상대 조건문은 빼고
    const s = summarizeAwareness([q])
    expect([s.hostile, s.hostileAware]).toEqual([2, 0])
  })

  it('자기 인식 검사: 정책을 유지한다는 문장의 다른 목적어(자본 스톡 등)는 정책 변경 주장으로 세지 않는다', () => {
    const claims = (text: string) => extractClaims(text, 'B국').map((c) => `${c.kind}:${c.dir}`)
    // gemma4 시험판에서 '말만 함'으로 잘못 잡힌 문장
    expect(claims('높은 투자율(25%)을 유지하여 생산 기반을 확충하고 자본 지수를 높이는 전략을 지속합니다.')).toEqual([])
    expect(claims('현재의 투자율 26%는 적절하며, 이를 유지함으로써 임기 말 자본 지수를 높이는 전략을 지속합니다.')).toEqual([])
    expect(claims('지속적으로 낮은 관세 환경을 유지하며 기술재 수입을 통한 자본 확대를 지속하자.')).toEqual([])
    expect(claims('높은 투자율(28%)을 통해 자본 스톡을 효과적으로 늘려오고 있습니다.')).toEqual([])
    expect(claims('현재의 목표는 자본 증대이므로 투자율 22%를 유지하며 산업기계와 전자부품 생산량 확대에 집중할 것')).toEqual([])
    expect(claims('현재의 낮은 관세 체제를 유지하며 산업기계와 전자부품의 생산량 확대와 자본 스톡 확충에 집중할 것')).toEqual([])
    expect(claims('관세는 그대로 두고 산업기계 수출 통제를 강화했다.')).toEqual(['control:up'])
    // 실제 변경 주장은 그대로 잡는다
    expect(claims('투자율을 28%로 높였다.')).toEqual(['investment:up'])
    expect(claims('산업기계 수출 통제를 한 단계 낮췄다.')).toEqual(['control:down'])
    expect(claims('곡물 관세를 5%에서 2%로 인하한다.')).toEqual(['tariff:down'])
    expect(claims('수출 통제 단계를 2로 올렸다.')).toEqual(['control:up'])
  })

  it('범위를 벗어난 정책 값은 고치고 기록한다', () => {
    const a = keepPolicyAction(statusQuoPolicy())
    a.policy.tariffsPct.grain = 900
    a.policy.investmentRatePct = 80
    const { policy, clamped } = applyDecision(statusQuoPolicy(), a)
    expect(policy.tariffs[0]).toBe(2)
    expect(policy.investmentRate).toBe(0.35)
    expect(clamped).toHaveLength(2)
  })

  it('결과 인식 검사: 생활수준이 떨어진 분기에 하락을 알아챘는지, 좋게 썼는지 가른다', () => {
    const quarter = (q: number, ls: number) => ({ type: 'quarter', quarter: q, indicators: { A: { livingStandard: ls }, B: { livingStandard: 100 } } })
    const decision = (q: number, reasoning: string) => ({ type: 'decision', quarter: q, country: 'A', action: { ...keepPolicyAction(statusQuoPolicy()), reasoning } })
    const events = [
      decision(0, ''),
      quarter(0, 98.1),
      decision(1, '이 구조는 자본 축적과 생활수준 유지에 매우 효과적입니다.'), // 98.1을 보고 좋게 씀 (gemma4 시험판 문장)
      quarter(1, 97.5),
      decision(2, '생활수준 지수는 97.5로 소폭 하락했으나 자본은 늘었다.'), // 알아챔 (소수점에서 문장을 자르지 않는다)
      quarter(2, 99.6),
      decision(3, '국민 생활 수준 향상을 위해 관세를 유지한다.'), // 99.6: 하락 1 미만이라 검사 안 함
      quarter(3, 97),
      decision(4, '국민 생활 수준 향상을 위해 협력한다.'), // 목표 문장은 평가가 아니다 → 언급 없음
    ] as unknown as GameEvent[]
    expect(outcomeReading(events, 'A').map((x) => [x.quarter, x.status])).toEqual([
      [1, 'misread'],
      [2, 'noticed'],
      [4, 'silent'],
    ])
  })

  it('100%를 넘는 투자율은 단위 실수로 보고 현재 값을 유지한다', () => {
    const prev = statusQuoPolicy()
    prev.investmentRate = 0.25
    const a = keepPolicyAction(prev)
    a.policy.investmentRatePct = 2500 // gemma4 시험판: "투자율(25%)을 유지"라고 쓰고 2500 출력
    const { policy, clamped } = applyDecision(prev, a)
    expect(policy.investmentRate).toBe(0.25)
    expect(clamped).toEqual(['투자율 2500% (100% 초과, 단위 오류) → 유지 25%'])
  })
})

describe('LLM 대통령', () => {
  const decisionJson = (keys: string[]) => ({
    reasoning: 'r',
    accept_proposals: [],
    message: '',
    tone: 'neutral',
    tariffs_pct: Object.fromEntries(keys.map((k) => [k, k === 'N2' || k === 'energy' ? 12 : 5])),
    export_controls: Object.fromEntries(keys.map((k) => [k, 0])),
    investment_rate_pct: 25,
    memo_to_self: '',
    handover_memo: '',
  })
  const ok = (json: unknown) => ({ ok: true, json, text: '', model: 'fake', requestedModel: 'fake', stopReason: 'end_turn', usage: {}, fallback: false, latencyMs: 0 })

  it('익명 모드의 키를 물품으로 되돌리고, 첫 응답이 깨지면 한 번 다시 묻는다', async () => {
    let calls = 0
    const transport: LlmTransport = async (req) => {
      calls++
      const keys = Object.keys((req.schema as { properties: { tariffs_pct: { properties: object } } }).properties.tariffs_pct.properties)
      return calls === 1 ? { ...ok(null), ok: false, error: 'bad' } : ok(decisionJson(keys))
    }
    const leader = new LlmLeader({ model: 'fake', transport, naming: 'abstract', culture: 'shown', objective: 'absolute', country: 'A', termQuarters: 16, totalQuarters: 48 })
    const g = new Game({ ...DEFAULT_CONFIG, naming: 'abstract' }, { A: leader, B: new RuleLeader('status-quo') }, world)
    const { action, meta } = await leader.decide(g.observation('A', 2), { message: '', tone: 'neutral', proposals: [] })
    expect(calls).toBe(2)
    expect(meta.error).toMatch(/재시도/)
    expect(action.policy.tariffsPct.energy).toBe(12)
    expect(action.policy.investmentRatePct).toBe(25)
  })

  it('익명 모드 프롬프트에는 실제 물품 이름이 나오지 않는다', () => {
    const g = new Game({ ...DEFAULT_CONFIG, naming: 'abstract' }, { A: new RuleLeader('status-quo'), B: new RuleLeader('status-quo') }, world)
    const text = systemPrompt('A', 'relative', 'abstract', 'shown', 16, 48) + describeObservation(g.observation('A', 2))
    for (const n of REAL_NAMES) expect(text).not.toContain(n)
  })

  it('문화 설명은 조건이 shown일 때만 프롬프트에 들어가고, 취향·노동 인구 수치는 항상 들어간다', () => {
    const shown = systemPrompt('A', 'absolute', 'real', 'shown', 16, 48)
    const hidden = systemPrompt('A', 'absolute', 'real', 'hidden', 16, 48)
    expect(shown).toContain(CULTURE.B.traits[0])
    expect(hidden).not.toContain(CULTURE.B.traits[0])
    expect(hidden).not.toContain(CULTURE.A.label)
    for (const text of [shown, hidden]) {
      expect(text).toContain('경제활동참가율 55%')
      expect(text).toContain('기본 지출 비중')
      expect(text).toContain('임기 말 자본 지수')
    }
  })

  it('두 번 다 실패하면 현재 정책을 유지한다', async () => {
    const transport: LlmTransport = async () => ({ ...ok(null), ok: false, error: 'down' })
    const leader = new LlmLeader({ model: 'fake', transport, naming: 'real', culture: 'shown', objective: 'absolute', country: 'B', termQuarters: 16, totalQuarters: 48 })
    const g = new Game(DEFAULT_CONFIG, { A: new RuleLeader('status-quo'), B: leader }, world)
    const { action, meta } = await leader.decide(g.observation('B', 2), { message: '', tone: 'neutral', proposals: [] })
    expect(meta.error).toBe('down')
    expect(action.policy.tariffsPct.grain).toBe(5)
  })
})
