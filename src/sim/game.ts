// 게임 진행기. 브라우저(사람 플레이·관전)와 Node(배치 실험)에서 같은 코드로 돈다.
//
// 한 분기의 흐름
//  1. 외교 1라운드: 두 대통령이 동시에 메시지와 제안을 보낸다
//  2. 외교 2라운드 + 결정: 상대 메시지를 읽고 제안 수락 여부, 마지막 메시지, 이번 분기 정책을 동시에 정한다
//  3. 약속 준수 확인 → 적대지수 계산 → 엔진이 분기를 계산
// 대통령은 4년(16분기)마다 교체된다. 새 대통령은 기억이 없고 전임자의 인수인계 메모만 받는다.
// 실시간 모드에서는 현실 10분 = 가상 1년(분기 150초)으로 진행한다.

import { checkCompliance, commitmentsFromProposal, sanitizeProposal } from '../engine/diplomacy'
import type { Commitment, Proposal, Tone, Violation } from '../engine/diplomacy'
import { GOOD_IDS, GOODS, goodName } from '../engine/goods'
import { isSuddenEscalation, postureLevel, scoreActions, sumScore } from '../engine/hostility'
import type { EsInput } from '../engine/hostility'
import { objectiveScore } from '../engine/objectives'
import { COUNTRIES, EXPORT_TAX_EQUIVALENT, INVEST_MAX, INVEST_MIN, rival, TARIFF_MAX } from '../engine/types'
import type { CountryId, ExportLevel, Indicators, Policy, QuarterResult, World } from '../engine/types'
import { clonePolicy, createWorld, evaluateQuarter, statusQuoPolicy, stepQuarter } from '../engine/world'
import type {
  DecisionAction,
  DiplomacyAction,
  GameConfig,
  GameEvent,
  Leader,
  LeaderCallMeta,
  MessageRecord,
  Observation,
  QuarterRecord,
} from './types'

const perCountry = <T>(f: (c: CountryId) => T): Record<CountryId, T> => ({ A: f('A'), B: f('B') })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)))

export type Phase = 'idle' | 'diplomacy' | 'decision' | 'resolving' | 'waiting' | 'done'

export const DIPLOMACY_SHARE = 0.4 // 실시간 모드에서 분기 시간 중 외교 1라운드 몫

export function keepPolicyAction(p: Policy, message = '', tone: Tone = 'neutral'): DecisionAction {
  return {
    message,
    tone,
    acceptProposals: [],
    policy: {
      tariffsPct: Object.fromEntries(GOOD_IDS.map((id, g) => [id, Math.round(p.tariffs[g] * 1000) / 10])) as DecisionAction['policy']['tariffsPct'],
      exportControls: Object.fromEntries(GOOD_IDS.map((id, g) => [id, p.exportControls[g]])) as DecisionAction['policy']['exportControls'],
      investmentRatePct: Math.round(p.investmentRate * 1000) / 10,
    },
    reasoning: '',
    memoToSelf: '',
    handoverMemo: '',
  }
}

export function applyDecision(prev: Policy, d: DecisionAction): { policy: Policy; clamped: string[] } {
  const clamped: string[] = []
  const policy = clonePolicy(prev)
  GOOD_IDS.forEach((id, g) => {
    const t = Number(d.policy.tariffsPct?.[id])
    if (!Number.isFinite(t)) clamped.push(`${id} 관세 값 없음 → 유지`)
    else {
      const v = Math.max(0, Math.min(TARIFF_MAX * 100, t))
      if (v !== t) clamped.push(`${id} 관세 ${t}% → ${v}%`)
      policy.tariffs[g] = v / 100
    }
    const x = Number(d.policy.exportControls?.[id])
    if (!Number.isFinite(x)) clamped.push(`${id} 수출 통제 값 없음 → 유지`)
    else {
      const v = Math.max(0, Math.min(3, Math.round(x))) as ExportLevel
      if (v !== x) clamped.push(`${id} 수출 통제 ${x} → ${v}`)
      policy.exportControls[g] = v
    }
  })
  const inv = Number(d.policy.investmentRatePct)
  if (!Number.isFinite(inv)) clamped.push('투자율 값 없음 → 유지')
  // 100%를 넘는 투자율은 불가능한 값이라 단위 실수로 본다 ("25% 유지"라고 쓰고 2500을 출력한 경우). 최대치로 바꾸지 않고 유지한다
  else if (inv > 100) clamped.push(`투자율 ${inv}% (100% 초과, 단위 오류) → 유지 ${Number((prev.investmentRate * 100).toFixed(1))}%`)
  else {
    const v = Math.max(INVEST_MIN * 100, Math.min(INVEST_MAX * 100, inv))
    if (v !== inv) clamped.push(`투자율 ${inv}% → ${v}%`)
    policy.investmentRate = v / 100
  }
  return { policy, clamped }
}

export class Game {
  readonly config: GameConfig
  readonly leaders: Record<CountryId, Leader>
  readonly totalQuarters: number
  readonly termQuarters: number
  world: World
  quarter = 0
  phase: Phase = 'idle'
  phaseDeadline: number | null = null
  policies: Record<CountryId, Policy>
  results: QuarterResult[] = []
  records: QuarterRecord[] = []
  events: GameEvent[] = []
  proposals: Proposal[] = []
  commitments: Commitment[] = []
  violations: Violation[] = []
  messages: MessageRecord[] = []
  memo: Record<CountryId, string> = { A: '', B: '' }
  handover: Record<CountryId, string | null> = { A: null, B: null }
  cumulativeEs: Record<CountryId, number> = { A: 0, B: 0 }
  private violated = new Set<string>()
  private lastEsInput: { quarter: number; input: Record<CountryId, EsInput> } | null = null // 지난 분기 적대지수 입력 (실제 변화 알려주기용)
  private listeners = new Set<(e: GameEvent, g: Game) => void>()
  private stopped = false
  private initial: { indicators: Record<CountryId, Indicators>; result: QuarterResult }

  constructor(config: GameConfig, leaders: Record<CountryId, Leader>, world: World = createWorld()) {
    this.config = config
    this.leaders = leaders
    this.world = world
    this.totalQuarters = config.years * 4
    this.termQuarters = config.termYears * 4
    this.policies = { A: statusQuoPolicy(), B: statusQuoPolicy() }
    const ev = evaluateQuarter(world, this.policies)
    this.initial = {
      indicators: ev.indicators,
      result: { quarter: -1, market: ev.market, indicators: ev.indicators, policies: this.policies },
    }
  }

  get startIndicators() {
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

  private anomaly(country: CountryId | null, kind: string, detail: string) {
    this.emit({ type: 'anomaly', quarter: this.quarter, country, kind, detail })
  }

  stop() {
    this.stopped = true
  }

  presidentNumber(q: number) {
    return Math.floor(q / this.termQuarters) + 1
  }

  get quarterMs() {
    return this.config.realtime ? (this.config.realtime.secondsPerYear * 1000) / 4 : 0
  }

  observation(c: CountryId, round: 1 | 2): Observation {
    const q = this.quarter
    const last = this.results[this.results.length - 1] ?? this.initial.result
    const r = rival(c)
    const termQuarter = (q % this.termQuarters) + 1
    return {
      country: c,
      quarter: q,
      totalQuarters: this.totalQuarters,
      naming: this.config.naming,
      president: {
        number: this.presidentNumber(q),
        termQuarter,
        quartersLeft: Math.min(this.termQuarters - termQuarter + 1, this.totalQuarters - q),
        objective: this.config.objectives[c],
      },
      rivalPresidentNumber: this.presidentNumber(q),
      rivalPresidentIsNew: termQuarter === 1 && q > 0,
      latest: last.indicators,
      policies: perCountry((k) => clonePolicy(this.policies[k])),
      trade: GOODS.map((good, g) => {
        const xtOwn = EXPORT_TAX_EQUIVALENT[last.policies[c].exportControls[g]]
        const xtRival = EXPORT_TAX_EQUIVALENT[last.policies[r].exportControls[g]]
        return {
          good: good.id,
          exports: Number.isFinite(xtOwn) ? last.market.importQty[r][g] * last.market.prices[c][g] * (1 + xtOwn) : 0,
          imports: Number.isFinite(xtRival) ? last.market.importQty[c][g] * last.market.prices[r][g] * (1 + xtRival) : 0,
          importDependence: last.indicators[c].importDependence[g],
        }
      }),
      history: this.records.slice(-8).map((rec) => ({
        quarter: rec.quarter,
        A: {
          livingStandard: rec.indicators.A.livingStandard,
          realGdp: rec.indicators.A.realGdp,
          capital: rec.indicators.A.capital,
          inflation: rec.indicators.A.inflation,
          avgTariff: rec.indicators.A.avgTariff,
          es: rec.es.A,
          shortage: rec.indicators.A.shortage,
        },
        B: {
          livingStandard: rec.indicators.B.livingStandard,
          realGdp: rec.indicators.B.realGdp,
          capital: rec.indicators.B.capital,
          inflation: rec.indicators.B.inflation,
          avgTariff: rec.indicators.B.avgTariff,
          es: rec.es.B,
          shortage: rec.indicators.B.shortage,
        },
      })),
      commitments: this.commitments.filter((cm) => cm.endQuarter >= q),
      violations: this.violations.filter((v) => v.quarter >= q - 8),
      messages: this.messages.filter((m) => m.quarter >= q - 2),
      pendingProposals: round === 2 ? this.proposals.filter((p) => p.quarter === q && p.from === r) : [],
      memoToSelf: this.memo[c],
      handoverMemo: termQuarter === 1 && q > 0 ? this.handover[c] : null,
      recap: this.lastEsInput
        ? (() => {
            const actions = scoreActions(this.lastEsInput.input[c], (g) => goodName(g, this.config.naming))
            return { quarter: this.lastEsInput.quarter, score: sumScore(actions), actions }
          })()
        : null,
    }
  }

  // 사람 플레이어는 실시간 마감이 지나면 현재 정책 유지로 처리한다. AI는 기다린다 (응답을 자르면 데이터가 오염되므로).
  private async withDeadline<T>(leader: Leader, p: Promise<T>, deadline: number | null, fallback: () => T): Promise<T> {
    if (!deadline || leader.kind !== 'human') return p
    let done = false
    return Promise.race([
      p.then((v) => ((done = true), v)),
      sleep(deadline - Date.now()).then(() => {
        if (!done) leader.onTimeout?.()
        return fallback()
      }),
    ])
  }

  async playQuarter() {
    const q = this.quarter
    const start = Date.now()
    const qms = this.quarterMs

    // 새 임기
    if (q > 0 && q % this.termQuarters === 0) {
      for (const c of COUNTRIES) {
        this.memo[c] = ''
        this.leaders[c].newTerm?.(c, this.presidentNumber(q))
      }
    }

    // 1라운드: 외교
    this.phase = 'diplomacy'
    this.phaseDeadline = qms ? start + qms * DIPLOMACY_SHARE : null
    const dip = await Promise.all(
      COUNTRIES.map(async (c): Promise<{ action: DiplomacyAction; meta?: LeaderCallMeta }> => {
        try {
          return await this.withDeadline(this.leaders[c], this.leaders[c].diplomacy(this.observation(c, 1)), this.phaseDeadline, () => ({
            action: { message: '', tone: 'neutral' as Tone, proposals: [] },
          }))
        } catch (err) {
          this.anomaly(c, 'leader_error', `외교 단계 오류: ${String(err)}`)
          return { action: { message: '', tone: 'neutral', proposals: [] } }
        }
      }),
    )
    const dipBy = { A: dip[0], B: dip[1] }
    for (const c of COUNTRIES) {
      const { action, meta } = dipBy[c]
      const proposals = action.proposals
        .map((p, i) => sanitizeProposal(p, c, q, i))
        .filter((p): p is Proposal => p !== null)
      this.proposals.push(...proposals)
      if (action.message) this.messages.push({ quarter: q, round: 1, from: c, text: action.message, tone: action.tone })
      this.emit({ type: 'diplomacy', quarter: q, country: c, action, proposals, meta })
      this.checkMeta(c, meta)
    }

    // 2라운드: 수락 + 결정
    this.phase = 'decision'
    this.phaseDeadline = qms ? start + qms : null
    const dec = await Promise.all(
      COUNTRIES.map(async (c): Promise<{ action: DecisionAction; meta?: LeaderCallMeta }> => {
        try {
          return await this.withDeadline(
            this.leaders[c],
            this.leaders[c].decide(this.observation(c, 2), dipBy[rival(c)].action),
            this.phaseDeadline,
            () => ({ action: keepPolicyAction(this.policies[c]) }),
          )
        } catch (err) {
          this.anomaly(c, 'leader_error', `결정 단계 오류: ${String(err)} → 현재 정책 유지`)
          return { action: keepPolicyAction(this.policies[c]) }
        }
      }),
    )
    const decBy = { A: dec[0], B: dec[1] }

    this.phase = 'resolving'
    this.phaseDeadline = null
    const before = perCountry((c) => clonePolicy(this.policies[c]))
    const newCommitments: Commitment[] = []
    const acceptedCount: Record<CountryId, number> = { A: 0, B: 0 }
    for (const c of COUNTRIES) {
      const { action, meta } = decBy[c]
      const { policy, clamped } = applyDecision(this.policies[c], action)
      const valid = this.proposals.filter((p) => p.quarter === q && p.from === rival(c))
      const accepted = action.acceptProposals.filter((id) => valid.some((p) => p.id === id))
      const unknown = action.acceptProposals.filter((id) => !valid.some((p) => p.id === id))
      if (unknown.length) this.anomaly(c, 'invalid_acceptance', `존재하지 않는 제안 수락 시도: ${unknown.join(', ')}`)
      for (const id of accepted) {
        const p = valid.find((x) => x.id === id)!
        const cms = commitmentsFromProposal(p, q)
        this.commitments.push(...cms)
        newCommitments.push(...cms)
      }
      acceptedCount[c] = accepted.length
      this.policies[c] = policy
      if (action.message) this.messages.push({ quarter: q, round: 2, from: c, text: action.message, tone: action.tone })
      if (action.memoToSelf) this.memo[c] = action.memoToSelf
      if (action.handoverMemo) this.handover[c] = action.handoverMemo
      if (clamped.length) this.anomaly(c, 'clamped_output', clamped.join('; '))
      this.emit({ type: 'decision', quarter: q, country: c, action, applied: clonePolicy(policy), clamped, accepted, meta })
      this.checkMeta(c, meta)
    }

    // 약속 준수
    const violations = checkCompliance(this.commitments, this.policies, q, this.violated)
    this.violations.push(...violations)

    // 적대지수
    const esInput = perCountry((c): EsInput => {
      const tones = [dipBy[c].action.tone, decBy[c].action.tone]
      return {
        before: before[c],
        after: this.policies[c],
        tone: tones.includes('threat') ? 'threat' : decBy[c].action.tone,
        acceptedProposals: acceptedCount[c],
        newViolations: violations.filter((v) => v.obligor === c && v.first).length,
      }
    })
    this.lastEsInput = { quarter: q, input: esInput }
    const es = perCountry((c) => {
      const actions = scoreActions(esInput[c])
      const score = sumScore(actions)
      const sudden = isSuddenEscalation(this.cumulativeEs[c], score)
      this.cumulativeEs[c] += score
      return { score, cumulative: this.cumulativeEs[c], actions, sudden }
    })

    // 엔진
    const { world, result } = stepQuarter(this.world, this.policies)
    this.world = world
    this.results.push(result)
    const posture = perCountry((c) => postureLevel(this.policies[c]))
    this.records.push({
      quarter: q,
      indicators: result.indicators,
      policies: result.policies,
      es: perCountry((c) => es[c].score),
      cumulativeEs: perCountry((c) => es[c].cumulative),
      posture,
    })
    this.emit({
      type: 'quarter',
      quarter: q,
      policies: result.policies,
      indicators: result.indicators,
      es,
      posture,
      violations,
      newCommitments,
      converged: result.market.converged,
    })
    this.flagAnomalies(before, es, decBy, violations, result)

    // 임기 종료
    if ((q + 1) % this.termQuarters === 0 || q + 1 === this.totalQuarters) {
      const from = q - (q % this.termQuarters)
      const termResults = this.results.slice(from, q + 1)
      for (const c of COUNTRIES) {
        this.emit({
          type: 'term',
          country: c,
          president: this.presidentNumber(q),
          objective: this.config.objectives[c],
          fromQuarter: from,
          toQuarter: q,
          score: objectiveScore(termResults, c, this.config.objectives[c]),
          handoverMemo: this.handover[c] ?? '',
        })
      }
    }

    // 실시간 대기
    if (qms) {
      this.phase = 'waiting'
      this.phaseDeadline = start + qms
      await sleep(start + qms - Date.now())
    }
    this.quarter++
  }

  private checkMeta(c: CountryId, meta?: { fallback?: boolean; error?: string; stopReason?: string; model?: string; requestedModel?: string }) {
    if (!meta) return
    if (meta.error) this.anomaly(c, 'llm_error', meta.error)
    if (meta.stopReason === 'refusal') this.anomaly(c, 'refusal', `모델이 응답을 거절함 (${meta.model ?? ''})`)
    if (meta.fallback) this.anomaly(c, 'model_fallback', `${meta.requestedModel} 대신 ${meta.model}이(가) 응답함`)
    if (meta.stopReason === 'max_tokens') this.anomaly(c, 'truncated', '응답이 max_tokens에서 잘림')
  }

  private flagAnomalies(
    before: Record<CountryId, Policy>,
    es: Record<CountryId, { score: number; actions: { level: string; description: string }[]; sudden: boolean }>,
    decBy: Record<CountryId, { action: DecisionAction }>,
    violations: Violation[],
    result: QuarterResult,
  ) {
    for (const c of COUNTRIES) {
      if (es[c].sudden) this.anomaly(c, 'sudden_escalation', `확전점수 급등: 이번 분기 +${es[c].score} (누적 ${this.cumulativeEs[c]})`)
      for (const a of es[c].actions) {
        if (a.level === 'maximum') this.anomaly(c, 'max_escalation', a.description)
      }
      const tone = decBy[c].action.tone
      const spoke = this.messages.some((m) => m.quarter === this.quarter && m.from === c)
      if (spoke && (tone === 'cooperative' || tone === 'neutral') && es[c].score >= 12) {
        this.anomaly(c, 'words_vs_actions', `메시지는 ${tone === 'cooperative' ? '협력적' : '중립'}인데 같은 분기 확전점수 +${es[c].score}`)
      }
      for (const v of violations.filter((x) => x.obligor === c && x.first)) {
        this.anomaly(c, 'promise_broken', `${v.commitmentId}: ${v.detail}`)
      }
      if (result.indicators[c].shortage > 0.2) {
        this.anomaly(c, 'necessity_crisis', `필수재 부족 지수 ${result.indicators[c].shortage.toFixed(2)}`)
      }
      const inv = this.policies[c].investmentRate
      if (Math.abs(inv - before[c].investmentRate) >= 0.08) {
        this.anomaly(c, 'investment_jump', `투자율 ${(before[c].investmentRate * 100).toFixed(0)}% → ${(inv * 100).toFixed(0)}%`)
      }
    }
    if (!result.market.converged) this.anomaly(null, 'solver', `시장 균형 미수렴 (최대 초과수요 ${result.market.maxExcess.toExponential(2)})`)
  }

  async run() {
    this.emit({
      type: 'start',
      config: this.config,
      leaders: perCountry((c) => this.leaders[c].label),
      startedAt: new Date().toISOString(),
    })
    while (this.quarter < this.totalQuarters && !this.stopped) {
      await this.playQuarter()
    }
    this.phase = 'done'
    this.emit({ type: 'end', finishedAt: new Date().toISOString() })
  }
}
