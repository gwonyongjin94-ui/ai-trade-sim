// v2 게임 진행기 (6개국). v1(src/sim/game.ts)과 같은 분기 흐름이다.
//  1. 외교 1라운드: 6개국이 동시에 공개 성명·비공개 메시지·제안을 보낸다
//  2. 외교 2라운드 + 결정: 자기에게 온 메시지와 제안을 읽고, 수락할 제안·마지막 메시지·이번 분기 정책을 동시에 정한다
//  3. 수락 → 약속, 약속 준수 확인 → 엔진이 분기를 계산
// 나머지 세계의 정책, AI 블록이 나머지 세계에 매기는 관세·통제는 2023년 값으로 고정이다.
// 확전점수는 게임 중에 계산하지 않는다. 기록(정책 변화, 메시지, 약속)에서 사후에 "누가 누구에게"로 잰다.

import type { LeaderCallMeta } from '../../sim/types'
import { checkCompliance, commitmentsFromProposal, sanitizeProposal, TONES } from '../diplomacy'
import type { Commitment, Proposal, Tone, Violation } from '../diplomacy'
import { nominalRatio, objectiveScore } from '../objectives'
import { policyChanges, ratePct, tariffPct } from '../policy'
import type { PolicyChange } from '../policy'
import { BLOCS, isBloc, perRegion } from '../regions'
import type { BlocId, RegionId } from '../regions'
import { TRADED } from '../sectors'
import { INVEST_MAX, INVEST_MIN, TARIFF_MAX } from '../types'
import type { ExportLevel, Indicators, Policy, QuarterResult, World } from '../types'
import { clonePolicy, createWorld, evaluateQuarter, goodFlows, statusQuoPolicies, stepQuarter } from '../world'
import type { DecisionAction, DiplomacyAction, GameConfig, GameEvent, Leader, Message, Observation, OutgoingMessage } from './types'

const perBloc = <T>(f: (b: BlocId) => T): Record<BlocId, T> => Object.fromEntries(BLOCS.map((b) => [b, f(b)])) as Record<BlocId, T>
export const partnersOf = (c: BlocId) => BLOCS.filter((b) => b !== c)

export const silentDiplomacy = (): DiplomacyAction => ({ statement: { text: '', tone: 'neutral' }, messages: [], proposals: [] })

export function keepPolicyAction(p: Policy, self: BlocId, statement = '', tone: Tone = 'neutral'): DecisionAction {
  const table = (f: (j: BlocId, g: number) => number) =>
    Object.fromEntries(partnersOf(self).map((j) => [j, Object.fromEntries(TRADED.map((s, g) => [s.id, f(j, g)]))]))
  return {
    statement: { text: statement, tone },
    messages: [],
    acceptProposals: [],
    policy: {
      tariffsPct: table((j, g) => tariffPct(p.tariffs[j][g])),
      exportControls: table((j, g) => p.exportControls[j][g]),
      investmentRatePct: ratePct(p.investmentRate),
    },
    reasoning: '',
    memoToSelf: '',
    handoverMemo: '',
  }
}

// % 값을 0.1%p 단위 비율로. 시작 정책(scripts/build-v2-base.ts)과 같은 반올림이라 현재 값을 그대로 쓰면 정확히 같은 정책이 된다
const toGrid = (pct: number) => Math.round(pct * 10) / 1000

// 지도자가 쓴 정책을 적용한다. 값이 없으면 유지, 범위를 벗어나면 고친다. 고친 내용은 기록에 남긴다
export function applyDecision(prev: Policy, d: DecisionAction, self: BlocId): { policy: Policy; clamped: string[] } {
  const clamped: string[] = []
  const missing: string[] = []
  const policy = clonePolicy(prev)
  for (const j of partnersOf(self)) {
    const tj = d.policy.tariffsPct?.[j]
    const xj = d.policy.exportControls?.[j]
    TRADED.forEach((s, g) => {
      const t = Number(tj?.[s.id])
      if (tj?.[s.id] == null || !Number.isFinite(t)) missing.push(`${j}.${s.id} 관세`)
      else {
        const v = Math.max(0, Math.min(TARIFF_MAX * 100, t))
        if (v !== t) clamped.push(`${j}산 ${s.id} 관세 ${t}% → ${v}%`)
        policy.tariffs[j][g] = toGrid(v)
      }
      const x = Number(xj?.[s.id])
      if (xj?.[s.id] == null || !Number.isFinite(x)) missing.push(`${j}.${s.id} 수출 통제`)
      else {
        const v = Math.max(0, Math.min(3, Math.round(x))) as ExportLevel
        if (v !== x) clamped.push(`${j} ${s.id} 수출 통제 ${x} → ${v}`)
        policy.exportControls[j][g] = v
      }
    })
  }
  if (missing.length) clamped.push(`값 없음 ${missing.length}개 → 유지: ${missing.slice(0, 6).join(', ')}${missing.length > 6 ? ' 등' : ''}`)
  const inv = Number(d.policy.investmentRatePct)
  if (!Number.isFinite(inv)) clamped.push('투자율 값 없음 → 유지')
  // 100%를 넘는 투자율은 단위 실수로 본다 (v1에서 "25% 유지"라고 쓰고 2500을 출력한 일이 있었다). 최대치로 바꾸지 않고 유지한다
  else if (inv > 100) clamped.push(`투자율 ${inv}% (100% 초과, 단위 오류) → 유지 ${ratePct(prev.investmentRate)}%`)
  else {
    const v = Math.max(INVEST_MIN * 100, Math.min(INVEST_MAX * 100, inv))
    if (v !== inv) clamped.push(`투자율 ${inv}% → ${v}%`)
    policy.investmentRate = toGrid(v)
  }
  return { policy, clamped }
}

const asTone = (x: unknown): Tone => (TONES.includes(x as Tone) ? (x as Tone) : 'neutral')

// 받는 나라가 잘못된 메시지(자기 자신, 없는 나라)와 빈 메시지는 버린다
function cleanMessages(from: BlocId, list: OutgoingMessage[]): { kept: OutgoingMessage[]; dropped: string[] } {
  const kept: OutgoingMessage[] = []
  const dropped: string[] = []
  for (const m of list) {
    if (!m.text?.trim()) continue
    if (!isBloc(m.to as RegionId) || m.to === from) dropped.push(`메시지 받는 나라 ${String(m.to)}`)
    else kept.push({ to: m.to, text: m.text, tone: asTone(m.tone) })
  }
  return { kept, dropped }
}

export class Game {
  readonly config: GameConfig
  readonly leaders: Record<BlocId, Leader>
  readonly totalQuarters: number
  readonly termQuarters: number
  world: World
  quarter = 0
  policies: Record<RegionId, Policy>
  results: QuarterResult[] = []
  events: GameEvent[] = []
  proposals: Proposal[] = []
  commitments: Commitment[] = []
  violations: Violation[] = []
  messages: Message[] = []
  memo: Record<BlocId, string> = perBloc(() => '')
  handover: Record<BlocId, string | null> = perBloc(() => null)
  private violated = new Set<string>()
  private lastChanges: { quarter: number; changes: Record<BlocId, PolicyChange[]> } | null = null
  private listeners = new Set<(e: GameEvent, g: Game) => void>()
  private stopped = false
  private initial: QuarterResult
  private lastFlows: Record<RegionId, Record<RegionId, number[]>>

  constructor(config: GameConfig, leaders: Record<BlocId, Leader>, world: World = createWorld()) {
    this.config = config
    this.leaders = leaders
    this.world = world
    this.totalQuarters = config.years * 4
    this.termQuarters = config.termYears * 4
    this.policies = statusQuoPolicies()
    const ev = evaluateQuarter(world, this.policies)
    this.initial = { quarter: -1, market: ev.market, indicators: ev.indicators, policies: perRegion((r) => clonePolicy(this.policies[r])) }
    this.lastFlows = goodFlows(ev.market, this.policies)
  }

  get startIndicators(): Record<RegionId, Indicators> {
    return this.initial.indicators
  }

  onEvent(cb: (e: GameEvent, g: Game) => void) {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(e: GameEvent) {
    this.events.push(e)
    for (const cb of this.listeners) cb(e, this)
  }

  private anomaly(country: BlocId | null, kind: string, detail: string) {
    this.emit({ type: 'anomaly', quarter: this.quarter, country, kind, detail })
  }

  stop() {
    this.stopped = true
  }

  leaderNumber(q: number) {
    return Math.floor(q / this.termQuarters) + 1
  }

  observation(c: BlocId, round: 1 | 2): Observation {
    const q = this.quarter
    const last = this.results[this.results.length - 1] ?? this.initial
    const termQuarter = (q % this.termQuarters) + 1
    return {
      country: c,
      quarter: q,
      totalQuarters: this.totalQuarters,
      naming: this.config.naming,
      leader: {
        number: this.leaderNumber(q),
        termQuarter,
        quartersLeft: Math.min(this.termQuarters - termQuarter + 1, this.totalQuarters - q),
        objective: this.config.objectives[c],
      },
      othersNew: termQuarter === 1 && q > 0,
      start: this.initial.indicators,
      latest: last.indicators,
      policies: perRegion((r) => clonePolicy(this.policies[r])),
      flows: this.lastFlows,
      history: this.results.slice(-8).map((res) => ({
        quarter: res.quarter,
        blocs: perBloc((b) => {
          const x = res.indicators[b]
          return {
            livingStandard: x.livingStandard,
            realGdp: x.realGdp,
            nominalGdpUsd: x.nominalGdpUsd,
            capital: x.capital,
            inflation: x.inflation,
            ratio: nominalRatio(res.indicators, b),
          }
        }),
      })),
      commitments: this.commitments.filter((cm) => cm.endQuarter >= q),
      violations: this.violations.filter((v) => v.quarter >= q - 8),
      messages: this.messages.filter((m) => m.quarter >= q - 2 && (m.to === 'all' || m.from === c || m.to === c)),
      pendingProposals: round === 2 ? this.proposals.filter((p) => p.quarter === q && p.to.includes(c)) : [],
      ownProposals: round === 2 ? this.proposals.filter((p) => p.quarter === q && p.from === c) : [],
      memoToSelf: this.memo[c],
      handoverMemo: termQuarter === 1 && q > 0 ? this.handover[c] : null,
      recap: this.lastChanges ? { quarter: this.lastChanges.quarter, changes: this.lastChanges.changes[c] } : null,
    }
  }

  private pushMessages(q: number, round: 1 | 2, c: BlocId, statement: { text: string; tone: Tone }, messages: OutgoingMessage[]) {
    if (statement.text?.trim()) this.messages.push({ quarter: q, round, from: c, to: 'all', text: statement.text, tone: asTone(statement.tone) })
    for (const m of messages) this.messages.push({ quarter: q, round, from: c, to: m.to, text: m.text, tone: m.tone })
  }

  async playQuarter() {
    const q = this.quarter

    if (q > 0 && q % this.termQuarters === 0) {
      for (const c of BLOCS) {
        this.memo[c] = ''
        this.leaders[c].newTerm?.(c, this.leaderNumber(q))
      }
    }

    // 1라운드: 외교
    const dip = await Promise.all(
      BLOCS.map(async (c): Promise<{ action: DiplomacyAction; meta?: LeaderCallMeta }> => {
        try {
          return await this.leaders[c].diplomacy(this.observation(c, 1))
        } catch (err) {
          this.anomaly(c, 'leader_error', `외교 단계 오류: ${String(err)}`)
          return { action: silentDiplomacy() }
        }
      }),
    )
    const dipBy = perBloc((b) => dip[BLOCS.indexOf(b)])
    for (const c of BLOCS) {
      const { action, meta } = dipBy[c]
      const { kept, dropped } = cleanMessages(c, action.messages ?? [])
      const proposals: Proposal[] = []
      ;(action.proposals ?? []).forEach((p, i) => {
        const s = sanitizeProposal(p, c, q, i)
        if (s) proposals.push(s)
        else dropped.push(`제안 ${i + 1}: 받는 나라나 조건이 유효하지 않음`)
      })
      this.proposals.push(...proposals)
      this.pushMessages(q, 1, c, action.statement ?? { text: '', tone: 'neutral' }, kept)
      this.emit({ type: 'diplomacy', quarter: q, country: c, action, proposals, dropped, meta })
      if (dropped.length) this.anomaly(c, 'invalid_diplomacy', dropped.join('; '))
      this.checkMeta(c, meta)
    }

    // 2라운드: 수락 + 결정
    const dec = await Promise.all(
      BLOCS.map(async (c): Promise<{ action: DecisionAction; meta?: LeaderCallMeta }> => {
        try {
          return await this.leaders[c].decide(this.observation(c, 2))
        } catch (err) {
          this.anomaly(c, 'leader_error', `결정 단계 오류: ${String(err)} → 현재 정책 유지`)
          return { action: keepPolicyAction(this.policies[c], c) }
        }
      }),
    )
    const decBy = perBloc((b) => dec[BLOCS.indexOf(b)])

    const before = perBloc((c) => clonePolicy(this.policies[c]))
    const acceptedBy = perBloc((): string[] => [])
    const changes = perBloc((): PolicyChange[] => [])
    for (const c of BLOCS) {
      const { action, meta } = decBy[c]
      const { policy, clamped } = applyDecision(this.policies[c], action, c)
      const valid = this.proposals.filter((p) => p.quarter === q && p.to.includes(c))
      const ids = [...new Set(action.acceptProposals ?? [])]
      acceptedBy[c] = ids.filter((id) => valid.some((p) => p.id === id))
      const unknown = ids.filter((id) => !valid.some((p) => p.id === id))
      if (unknown.length) this.anomaly(c, 'invalid_acceptance', `받지 않은 제안 수락 시도: ${unknown.join(', ')}`)
      const { kept, dropped } = cleanMessages(c, action.messages ?? [])
      this.pushMessages(q, 2, c, action.statement ?? { text: '', tone: 'neutral' }, kept)
      this.policies[c] = policy
      changes[c] = policyChanges(c, before[c], policy)
      if (action.memoToSelf) this.memo[c] = action.memoToSelf
      if (action.handoverMemo) this.handover[c] = action.handoverMemo
      if (clamped.length) this.anomaly(c, 'clamped_output', clamped.join('; '))
      if (dropped.length) this.anomaly(c, 'invalid_diplomacy', dropped.join('; '))
      this.emit({
        type: 'decision',
        quarter: q,
        country: c,
        action,
        applied: clonePolicy(policy),
        changes: changes[c],
        clamped,
        accepted: acceptedBy[c],
        dropped,
        meta,
      })
      this.checkMeta(c, meta)
    }

    // 수락 → 약속 (받은 나라들이 동시에 정하므로 모든 결정을 모은 뒤에 묶는다)
    const newCommitments: Commitment[] = []
    for (const p of this.proposals.filter((x) => x.quarter === q)) {
      const cms = commitmentsFromProposal(p, p.to.filter((b) => acceptedBy[b].includes(p.id)), q)
      this.commitments.push(...cms)
      newCommitments.push(...cms)
    }
    const violations = checkCompliance(this.commitments, this.policies, q, this.violated)
    this.violations.push(...violations)
    this.lastChanges = { quarter: q, changes }

    // 엔진
    const { world, result } = stepQuarter(this.world, this.policies)
    this.world = world
    this.results.push(result)
    this.lastFlows = goodFlows(result.market, result.policies)
    this.emit({
      type: 'quarter',
      quarter: q,
      policies: result.policies,
      indicators: result.indicators,
      ratio: perBloc((b) => nominalRatio(result.indicators, b)),
      violations,
      newCommitments,
      converged: result.market.converged,
    })
    this.flagAnomalies(before, changes, violations, result)

    // 임기 종료
    if ((q + 1) % this.termQuarters === 0 || q + 1 === this.totalQuarters) {
      const from = q - (q % this.termQuarters)
      const termResults = this.results.slice(from, q + 1)
      const startInd = from === 0 ? this.initial.indicators : this.results[from - 1].indicators
      for (const c of BLOCS) {
        const kind = this.config.objectives[c]
        this.emit({
          type: 'term',
          country: c,
          leader: this.leaderNumber(q),
          objective: kind,
          fromQuarter: from,
          toQuarter: q,
          score: objectiveScore(termResults, c, kind),
          startScore: kind === 'absolute' ? 100 : nominalRatio(startInd, c),
          handoverMemo: this.handover[c] ?? '',
        })
      }
    }
    this.quarter++
  }

  private checkMeta(c: BlocId, meta?: LeaderCallMeta) {
    if (!meta) return
    if (meta.error) this.anomaly(c, 'llm_error', meta.error)
    if (meta.stopReason === 'refusal') this.anomaly(c, 'refusal', `모델이 응답을 거절함 (${meta.model ?? ''})`)
    if (meta.fallback) this.anomaly(c, 'model_fallback', `${meta.requestedModel} 대신 ${meta.model}이(가) 응답함`)
    if (meta.stopReason === 'max_tokens') this.anomaly(c, 'truncated', '응답이 max_tokens에서 잘림')
  }

  private flagAnomalies(before: Record<BlocId, Policy>, changes: Record<BlocId, PolicyChange[]>, violations: Violation[], result: QuarterResult) {
    for (const c of BLOCS) {
      for (const ch of changes[c]) {
        if (ch.kind === 'export_control' && ch.to === 3) this.anomaly(c, 'embargo', `${ch.partner}에 ${ch.good} 전면 금지`)
        if (ch.kind === 'tariff' && ch.to - ch.from >= 50) this.anomaly(c, 'tariff_jump', `${ch.partner}산 ${ch.good} 관세 ${ch.from}% → ${ch.to}%`)
      }
      for (const v of violations.filter((x) => x.obligor === c && x.first)) {
        this.anomaly(c, 'promise_broken', `${v.commitmentId}: ${v.breaches.map((b) => `${b.partner}.${b.good} ${b.actual} > ${b.limit}`).join(', ')}`)
      }
      if (result.indicators[c].shortage > 0.2) this.anomaly(c, 'necessity_crisis', `필수재 부족 지수 ${result.indicators[c].shortage.toFixed(2)}`)
      const inv = this.policies[c].investmentRate
      if (Math.abs(inv - before[c].investmentRate) >= 0.08) {
        this.anomaly(c, 'investment_jump', `투자율 ${ratePct(before[c].investmentRate)}% → ${ratePct(inv)}%`)
      }
    }
    if (!result.market.converged) this.anomaly(null, 'solver', `시장 균형 미수렴 (최대 초과수요 ${result.market.maxExcess.toExponential(2)})`)
  }

  async run() {
    this.emit({
      type: 'start',
      version: 2,
      config: this.config,
      leaders: perBloc((c) => this.leaders[c].label),
      policies: perRegion((r) => clonePolicy(this.policies[r])),
      startedAt: new Date().toISOString(),
    })
    while (this.quarter < this.totalQuarters && !this.stopped) await this.playQuarter()
    this.emit({ type: 'end', finishedAt: new Date().toISOString() })
  }
}
