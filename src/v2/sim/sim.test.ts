import { describe, expect, it } from 'vitest'
import type { LlmResponse, LlmTransport } from '../../sim/llmTypes'
import { HOFSTEDE_DIMENSIONS } from '../culture'
import { largestOther, nominalRatio } from '../objectives'
import { BLOCS } from '../regions'
import type { BlocId } from '../regions'
import { sectorIndex, TRADED } from '../sectors'
import { createWorld, statusQuoPolicies } from '../world'
import { applyDecision, Game, keepPolicyAction } from './game'
import { decisionSchema, describeObservation, LlmLeader, systemPrompt } from './llm'
import { RuleLeader } from './rules'
import { Scripted } from './scripted'
import type { RuleKind } from './rules'
import type { GameConfig, Leader } from './types'
import { DEFAULT_CONFIG } from './types'

const world = createWorld()
const elec = sectorIndex('electronics')
const cfg = (over: Partial<GameConfig> = {}): GameConfig => ({ ...DEFAULT_CONFIG, years: 1, ...over })
const all = (f: (b: BlocId) => Leader) => Object.fromEntries(BLOCS.map((b) => [b, f(b)])) as Record<BlocId, Leader>
const rules = (kind: RuleKind) => all(() => new RuleLeader(kind))
const REAL_NAMES = ['대한민국', '한국', '중국', '북한', '홍콩', '일본', '중동', '사우디', '이란', '이스라엘', '미국', '캐나다', '멕시코', '대만', '유럽연합', '미중']

describe('v2 게임 진행', () => {
  it('시작 정책을 그대로 다시 쓰면 정책이 한 자리도 바뀌지 않는다 (0.1% 단위 반올림)', () => {
    const sq = statusQuoPolicies()
    for (const b of BLOCS) {
      const { policy, clamped } = applyDecision(sq[b], keepPolicyAction(sq[b], b), b)
      expect(clamped).toEqual([])
      expect(policy).toEqual(sq[b])
    }
  })

  it('현상 유지 6개국: 1년 동안 정책 변화 없이 정상상태, 임기 말 점수 기록', async () => {
    const g = new Game(cfg({ objectives: { A: 'relative', B: 'absolute', C: 'absolute', D: 'absolute', E: 'relative', F: 'absolute' } }), rules('status-quo'), world)
    await g.run()
    const decisions = g.events.filter((e) => e.type === 'decision')
    expect(decisions).toHaveLength(24)
    for (const d of decisions) if (d.type === 'decision') expect(d.changes).toEqual([])
    expect(g.events.filter((e) => e.type === 'anomaly')).toEqual([])
    const terms = g.events.filter((e) => e.type === 'term')
    expect(terms).toHaveLength(6)
    for (const t of terms) {
      if (t.type !== 'term') continue
      expect(t.fromQuarter).toBe(0)
      expect(t.toQuarter).toBe(3)
      expect(t.score).toBeCloseTo(t.startScore, 1)
    }
    const a = terms.find((t) => t.type === 'term' && t.country === 'A')
    expect(a?.type === 'term' && a.startScore).toBeCloseTo(5.8, 1)
  })

  it('상대 이익의 비교 대상: 미국에게는 중국, 나머지에게는 미국', () => {
    const ind = new Game(cfg(), rules('status-quo'), world).startIndicators
    expect(largestOther(ind, 'E')).toBe('B')
    for (const b of ['A', 'B', 'C', 'D', 'F'] as BlocId[]) expect(largestOther(ind, b)).toBe('E')
    expect(nominalRatio(ind, 'E')).toBeGreaterThan(100)
  })

  it('다자 제안: 수락한 나라끼리만 묶이고, 참가국이 아닌 나라에 대한 정책은 묶이지 않는다', async () => {
    const leaders = rules('status-quo')
    leaders.A = new Scripted(
      (obs) =>
        obs.quarter === 0
          ? { proposals: [{ to: ['B', 'C', 'D', 'A' as BlocId], terms: [{ obligor: 'all', kind: 'tariff_max', goods: ['electronics'], value: 0 }], durationQuarters: 4, note: '' }] }
          : {},
      (obs, a) => {
        if (obs.quarter === 0) a.policy.tariffsPct.B!.electronics = 0
        if (obs.quarter === 0) a.policy.tariffsPct.C!.electronics = 0
        if (obs.quarter === 2) {
          a.policy.tariffsPct.B!.electronics = 30 // 약속 위반
          a.policy.tariffsPct.D!.electronics = 30 // D는 수락하지 않아 위반이 아니다
        }
      },
    )
    for (const b of ['B', 'C'] as BlocId[]) {
      leaders[b] = new Scripted(undefined, (obs, a) => {
        if (obs.quarter === 0) a.acceptProposals = obs.pendingProposals.map((p) => p.id)
        if (obs.quarter === 0) a.policy.tariffsPct.A!.electronics = 0
      })
    }
    const g = new Game(cfg(), leaders, world)
    await g.run()
    const dip = g.events.find((e) => e.type === 'diplomacy' && e.country === 'A')
    expect(dip?.type === 'diplomacy' && dip.proposals[0].to).toEqual(['B', 'C', 'D']) // 자기 자신은 빠진다
    const cms = g.commitments
    expect(cms.map((c) => [c.obligor, c.toward])).toEqual([
      ['A', ['B', 'C']],
      ['B', ['A', 'C']],
      ['C', ['A', 'B']],
    ])
    expect(cms[0].startQuarter).toBe(1)
    // B는 일본산 전자 관세를 0으로 내리지 않았다 → 1분기부터 위반. 일본의 중국산 전자 관세는 원래 0이라 지킨다
    expect(g.policies.C.tariffs.B[elec]).toBe(0)
    const firsts = g.violations.filter((v) => v.first).map((v) => [v.obligor, v.quarter])
    expect(firsts).toEqual([
      ['B', 1],
      ['A', 2],
    ])
    const aViolation = g.violations.find((v) => v.obligor === 'A')!
    expect(aViolation.breaches.map((b) => [b.partner, b.good, b.actual])).toEqual([['B', 'electronics', 30]])
    expect(g.policies.A.tariffs.D[elec]).toBeCloseTo(0.3)
  })

  it('비공개 메시지는 받는 나라만, 공개 성명은 모두가 본다', async () => {
    const leaders = rules('status-quo')
    const spies = all(() => new Scripted())
    for (const b of BLOCS) leaders[b] = spies[b]
    leaders.A = new Scripted((obs) =>
      obs.quarter === 0
        ? { statement: { text: '공개', tone: 'neutral' }, messages: [{ to: 'B', text: '비밀', tone: 'cooperative' }, { to: 'A', text: '나에게', tone: 'neutral' }] }
        : {},
    )
    const g = new Game(cfg({ years: 1 }), leaders, world)
    await g.run()
    const round2 = (b: BlocId) => (leaders[b] as Scripted).seen.find((s) => s.round === 2 && s.obs.quarter === 0)!.obs
    expect(round2('B').messages.map((m) => m.text)).toEqual(['공개', '비밀'])
    expect(round2('C').messages.map((m) => m.text)).toEqual(['공개'])
    expect(round2('A').messages.map((m) => m.text)).toEqual(['공개', '비밀'])
    expect(g.events.some((e) => e.type === 'anomaly' && e.country === 'A' && e.kind === 'invalid_diplomacy')).toBe(true)
  })

  it('팃포탯은 상대국마다 따로, 2023년 대비 변화를 따라 한다', async () => {
    const leaders = rules('tit-for-tat')
    leaders.E = new Scripted(undefined, (obs, a) => {
      if (obs.quarter >= 1) for (const s of TRADED) a.policy.tariffsPct.B![s.id] += 20
    })
    const g = new Game(cfg(), leaders, world)
    await g.run()
    const sq = statusQuoPolicies()
    const at = (q: number) => g.results[q].policies
    expect(at(0).B).toEqual(sq.B) // 0분기: 아무도 바꾸지 않았다
    expect(at(1).B.tariffs.E).toEqual(sq.B.tariffs.E)
    for (let g2 = 0; g2 < TRADED.length; g2++) expect(at(2).B.tariffs.E[g2]).toBeCloseTo(sq.B.tariffs.E[g2] + 0.2, 6)
    for (const j of ['A', 'C', 'D', 'F'] as BlocId[]) expect(at(2).B.tariffs[j]).toEqual(sq.B.tariffs[j])
    for (const j of ['A', 'C', 'D', 'F'] as BlocId[]) expect(at(3)[j]).toEqual(sq[j]) // 다른 나라는 미국과 무관하다
  })

  it('자유무역 6개국: 1분기에 서로 제안하고 모두 수락해 관세가 0이 된다', async () => {
    const g = new Game(cfg(), rules('free-trade'), world)
    await g.run()
    expect(g.proposals.filter((p) => p.quarter === 0)).toHaveLength(6)
    // 제안 6개 × 조건 2개 × 참가국 6
    expect(g.commitments).toHaveLength(72)
    expect(g.violations).toEqual([])
    for (const b of BLOCS) for (const j of BLOCS) if (j !== b) expect(g.policies[b].tariffs[j].every((t) => t === 0)).toBe(true)
    const ls = g.results[3].indicators
    for (const b of BLOCS) expect(ls[b].livingStandard).toBeGreaterThan(99.5)
  })
})

describe('v2 LLM 지도자 (가짜 응답, 유료 호출 없음)', () => {
  const ok = (json: unknown): LlmResponse => ({ ok: true, json, text: '', model: 'fake', requestedModel: 'fake', stopReason: 'end_turn', usage: {}, fallback: false, latencyMs: 0 })

  it('익명 조건: 프롬프트 어디에도 실제 나라 이름이 없다. 실제 이름 조건에는 있다', async () => {
    const seen: string[] = []
    const transport: LlmTransport = async (req) => {
      seen.push(req.system, req.user)
      return ok(null)
    }
    const leaders = rules('status-quo')
    leaders.F = new LlmLeader({ model: 'fake', transport, naming: 'abstract', culture: 'shown', objective: 'relative', country: 'F', termQuarters: 16, totalQuarters: 16 })
    const g = new Game({ ...cfg({ naming: 'abstract' }), years: 1 }, leaders, world)
    await g.playQuarter()
    expect(seen.length).toBeGreaterThan(0)
    for (const text of seen) for (const n of REAL_NAMES) expect(text.replaceAll('한국어', ''), n).not.toContain(n) // '한국어로 쓴다'는 출력 언어
    expect(seen[0]).toContain('F국의 지도자')
    expect(seen[0]).toContain(HOFSTEDE_DIMENSIONS[0].name)
    const real = systemPrompt('A', 'relative', 'real', 'hidden', 16, 16)
    expect(real).toContain('대한민국의 지도자')
    expect(real).toContain('중국, 북한, 홍콩, 마카오')
    expect(real).not.toContain('권력거리')
    expect(real).toContain('명목 GDP 비율')
  })

  it('응답 형식: 상대 5개국 × 물품 10개, 자기 나라는 없다', () => {
    const s = decisionSchema('C') as { properties: { tariffs_pct: { required: string[]; properties: Record<string, { required: string[] }> } } }
    expect(s.properties.tariffs_pct.required).toEqual(['A', 'B', 'D', 'E', 'F'])
    expect(s.properties.tariffs_pct.properties.A.required).toEqual(TRADED.map((x) => x.id))
  })

  it('가짜 응답으로 한 판: 메시지·제안·정책이 기록되고, 지난 분기 실제 변화가 관측에 담긴다', async () => {
    const users: string[] = []
    const transport: LlmTransport = async (req) => {
      users.push(req.user)
      const props = req.schema.properties as Record<string, unknown>
      if ('proposals' in props)
        return ok({
          thinking: '생각',
          statement: { text: '모두와 협력하겠다', tone: 'cooperative' },
          messages: [{ to: 'B', text: '전자 관세를 낮추자', tone: 'cooperative' }],
          proposals: [{ to: ['B'], terms: [{ obligor: 'all', kind: 'tariff_max', goods: ['electronics'], value: 0 }], duration_quarters: 4, note: '전자 무관세' }],
        })
      // 현재 정책(프롬프트의 JSON)을 그대로 쓰되 중국산 전자 관세만 10%p 올린다
      const line = req.user.split('\n').find((l) => l.startsWith('{"tariffs_pct"'))!
      const cur = JSON.parse(line)
      cur.tariffs_pct.B.electronics += 10
      return ok({ reasoning: '이유', accept_proposals: [], statement: { text: '', tone: 'neutral' }, messages: [], ...cur, memo_to_self: '메모', handover_memo: '' })
    }
    const leaders = rules('status-quo')
    leaders.A = new LlmLeader({ model: 'fake', transport, naming: 'real', culture: 'hidden', objective: 'absolute', country: 'A', termQuarters: 16, totalQuarters: 16, recap: 'on' })
    const g = new Game({ ...cfg(), years: 1 }, leaders, world)
    await g.playQuarter()
    await g.playQuarter()
    expect(g.events.filter((e) => e.type === 'anomaly')).toEqual([])
    expect(g.messages.filter((m) => m.from === 'A' && m.quarter === 0).map((m) => m.to)).toEqual(['all', 'B'])
    expect(g.proposals.map((p) => p.id)).toEqual(['A1-1', 'A2-1'])
    const sq = statusQuoPolicies()
    expect(g.policies.A.tariffs.B[elec]).toBeCloseTo(sq.A.tariffs.B[elec] + 0.2, 6)
    const d0 = g.events.find((e) => e.type === 'decision' && e.country === 'A')
    expect(d0?.type === 'decision' && d0.changes).toEqual([{ kind: 'tariff', partner: 'B', good: 'electronics', from: 1.8, to: 11.8 }])
    // 2분기 프롬프트: 실제 변화 + 메모 + 우리가 보낸 메시지
    const q2 = users.find((u) => u.includes('# 현재: 1년차 2분기'))!
    expect(q2).toContain('지난 분기(1분기)에 우리나라가 실제로 바꾼 정책')
    expect(q2).toContain('중국산 수입품 관세: 전자·정밀기기 1.8% → 11.8% (+10%p)')
    expect(q2).toContain('대한민국(우리) → 중국 비공개 (협력적): 전자 관세를 낮추자')
    expect(q2).toContain('# 지난 분기에 네가 남긴 메모\n메모')
    expect(q2).not.toContain('확전')
  })

  it('관측 설명: 6개국 상황표·관세 행렬·수출 통제 목록이 들어간다', () => {
    const g = new Game(cfg(), rules('status-quo'), world)
    const text = describeObservation(g.observation('B', 1))
    expect(text).toContain('| 중국(우리) | 100.0 | 100.0 | 18.73 |')
    expect(text).toContain('미국 → 중국(우리): 반도체 1단계')
    expect(text).toContain('우리의 비교 대상은 지금 미국')
    expect(text.split('\n').filter((l) => l.startsWith('| semiconductors')).length).toBe(5) // 정책 2개 + 교역 3개 표
  })
})
