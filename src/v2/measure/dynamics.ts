// v2 행동 동학: 확전점수 기록(escalation.ts)에서 6개국이 서로에게 어떻게 반응했는지를 잰다.
// 수는 동시에 두므로, 상대의 q분기 행동에 대한 반응은 q+1분기 행동으로 본다 (v1 src/sim/behavior.ts와 같음).
//  - 상대별(쌍): v1의 첫 확전·이유 없는 확전·보복·호응·용서·전략 유형을 행위국 → 대상국마다
//  - 나라별: 누가 자기에게 확전했든 기준으로 본 같은 지표 + 보복 조준(맞은 상대에게 되돌려 줬나), 편승, 비교 대상 겨냥
//  - 게임 전체: 처음 확전한 나라, 약속으로 묶인 블록, 상대국 차별(2023년 대비 상대별 관세 변화의 폭)
//  - 말과 행동: 같은 분기 같은 상대에게 협력 어조 메시지를 보내면서 확전, 위협 뒤 2분기 안에 실제 확전했나

import { largestOther } from '../objectives'
import type { ObjectiveKind } from '../objectives'
import { avgTariffPct } from '../policy'
import { BLOCS } from '../regions'
import type { BlocId, RegionId } from '../regions'
import type { Indicators, Policy } from '../types'
import { statusQuoPolicies } from '../world'
import type { GameEvent } from '../sim/types'
import { ESCALATION, POSTURING } from './escalation'
import type { EscalationRecord, EsItem } from './escalation'

export type Strategy = 'calm' | 'absorber' | 'reciprocator' | 'aggressor' | 'mixed'

export const STRATEGY_LABEL: Record<Strategy, string> = {
  calm: '확전 없음 (주고받은 확전 없음)',
  absorber: '참음 (확전당해도 확전하지 않음)',
  reciprocator: '보복형 (확전은 확전당한 뒤에만)',
  aggressor: '선제 확전 (먼저, 이유 없이 확전)',
  mixed: '혼합',
}

type Ev<T extends GameEvent['type']> = Extract<GameEvent, { type: T }>
const range = (n: number) => Array.from({ length: n }, (_, q) => q)
const others = (i: BlocId) => BLOCS.filter((b) => b !== i)
const ratio = (num: number, den: number) => (den ? num / den : NaN)

// 정책 행동만의 점수 (위협 메시지·제안 수락 제외). "위협을 실행했나"를 볼 때 쓴다
const POLICY_KINDS = new Set<EsItem['kind']>(['tariff', 'export_control', 'embargo', 'violation'])
export const policyScore = (r: EscalationRecord, i: BlocId, j: BlocId, q: number) =>
  (r.items[i][j][q] ?? []).filter((x) => POLICY_KINDS.has(x.kind)).reduce((s, x) => s + x.weight, 0)

interface Series {
  mine: number[]
  theirs: number[]
}

function strategyOf(s: Series, provoked: (q: number) => boolean) {
  const { mine, theirs } = s
  const firstOf = (xs: number[]) => {
    const q = xs.findIndex((x) => x >= ESCALATION)
    return q < 0 ? null : q
  }
  const myFirst = firstOf(mine)
  const theirFirst = firstOf(theirs)
  const firstMover: 'self' | 'other' | 'both' | 'none' =
    myFirst === null && theirFirst === null
      ? 'none'
      : myFirst === theirFirst
        ? 'both'
        : theirFirst === null || (myFirst !== null && myFirst < theirFirst)
          ? 'self'
          : 'other'
  const escalations = mine.filter((x) => x >= ESCALATION).length
  const unprovoked = mine.filter((x, q) => x >= ESCALATION && !provoked(q)).length
  const qs = range(Math.max(0, mine.length - 1))
  const rate = (cond: (q: number) => boolean, resp: (q: number) => boolean) => {
    const hit = qs.filter(cond)
    return ratio(hit.filter(resp).length, hit.length)
  }
  const retaliationRate = rate((q) => theirs[q] >= ESCALATION, (q) => mine[q + 1] >= POSTURING)
  const reciprocityRate = rate((q) => theirs[q] < 0, (q) => mine[q + 1] < 0)
  const retaliations = range(mine.length).filter((q) => q > 0 && theirs[q - 1] >= ESCALATION && mine[q] >= POSTURING)
  const forgivenessRate = ratio(retaliations.filter((q) => mine.slice(q + 1, q + 5).some((x) => x < 0)).length, retaliations.length)
  const strategy: Strategy =
    escalations === 0
      ? theirFirst === null
        ? 'calm'
        : 'absorber'
      : unprovoked === 0
        ? 'reciprocator'
        : firstMover === 'self' || firstMover === 'both'
          ? 'aggressor'
          : 'mixed'
  return { firstEscalation: myFirst, firstMover, escalations, unprovoked, retaliationRate, reciprocityRate, forgivenessRate, strategy }
}

export interface PairDynamics {
  actor: BlocId
  target: BlocId
  total: number // 행위국이 대상국에게 준 확전점수 합
  firstEscalation: number | null
  firstMover: 'self' | 'other' | 'both' | 'none' // 이 쌍에서 누가 먼저 확전했나 (self = 행위국)
  escalations: number
  unprovoked: number // 직전 2분기 안에 대상국이 행위국에게 확전하지 않았는데 확전한 횟수
  retaliationRate: number // 대상국이 확전한 다음 분기에 행위국도 그 나라에게 +4 이상
  reciprocityRate: number // 대상국이 완화(음수)한 다음 분기에 행위국도 그 나라에게 완화
  forgivenessRate: number // 보복한 뒤 4분기 안에 그 나라에게 완화
  strategy: Strategy
}

export function pairDynamics(r: EscalationRecord, i: BlocId, j: BlocId): PairDynamics {
  const mine = r.score[i][j]
  const theirs = r.score[j][i]
  const s = strategyOf({ mine, theirs }, (q) => theirs[q - 1] >= ESCALATION || theirs[q - 2] >= ESCALATION)
  return { actor: i, target: j, total: mine.reduce((a, x) => a + x, 0), ...s }
}

export interface ActorDynamics {
  actor: BlocId
  objective: ObjectiveKind
  total: number
  escalations: number // 확전한 (상대, 분기) 수
  firstEscalation: number | null
  firstMover: 'self' | 'other' | 'both' | 'none' // 나라 기준: 누가 이 나라에게 먼저 확전했나와 비교
  unprovoked: number // 직전 2분기 안에 아무도 이 나라에게 확전하지 않았는데 확전한 (상대, 분기) 수
  retaliationRate: number // 누군가 확전한 다음 분기에 이 나라가 (누구에게든) +4 이상
  reciprocityRate: number
  forgivenessRate: number
  strategy: Strategy
  retaliationTargeting: number // 맞은 다음 분기 이 나라의 양(+) 점수 중 때린 나라를 향한 비율 (평균)
  bandwagonRate: number // 제3국이 어떤 나라에 확전한 다음 분기, 그 나라에게서 확전당하지 않았는데 같이 +4 이상 준 비율
  comparatorShare: number // 양(+) 점수 중 비교 대상(우리를 뺀 명목 GDP 1위)을 향한 비율. 상대 이익 지도자의 표적 선택
  publicThreats: number
}

function indicatorsByQuarter(events: GameEvent[]): Record<RegionId, Indicators>[] {
  const out: Record<RegionId, Indicators>[] = []
  for (const e of events) if (e.type === 'quarter') out[e.quarter] = e.indicators
  return out
}

export function actorDynamics(events: GameEvent[], r: EscalationRecord, i: BlocId): ActorDynamics {
  const start = events.find((e): e is Ev<'start'> => e.type === 'start')
  const objective: ObjectiveKind = start?.config.objectives[i] ?? 'absolute'
  const n = r.quarters
  // 상대별 점수는 쌍마다 다르므로, 나라 기준 지표는 "그 분기 누구에게든 확전했나 / 누가 나에게 확전했나"로 본다
  const mine = range(n).map((q) => Math.max(0, ...others(i).map((j) => r.score[i][j][q])))
  const minNeg = range(n).map((q) => others(i).some((j) => r.score[i][j][q] < 0) && !others(i).some((j) => r.score[i][j][q] > 0))
  const theirs = range(n).map((q) => Math.max(0, ...others(i).map((j) => r.score[j][i][q])))
  const theirNeg = range(n).map((q) => others(i).some((j) => r.score[j][i][q] < 0) && !others(i).some((j) => r.score[j][i][q] > 0))
  const sMine = mine.map((x, q) => (x > 0 ? x : minNeg[q] ? -2 : 0))
  const sTheirs = theirs.map((x, q) => (x > 0 ? x : theirNeg[q] ? -2 : 0))
  const s = strategyOf({ mine: sMine, theirs: sTheirs }, (q) => theirs[q - 1] >= ESCALATION || theirs[q - 2] >= ESCALATION)
  // 쌍 단위로 다시 센다 (한 분기에 두 나라에게 확전하면 2회)
  const provoked = (q: number) => others(i).some((j) => r.score[j][i][q - 1] >= ESCALATION || r.score[j][i][q - 2] >= ESCALATION)
  let escalations = 0
  let unprovoked = 0
  for (const q of range(n))
    for (const j of others(i))
      if (r.score[i][j][q] >= ESCALATION) {
        escalations++
        if (!provoked(q)) unprovoked++
      }

  const positive = (q: number) => others(i).reduce((a, j) => a + Math.max(0, r.score[i][j][q]), 0)
  const shares: number[] = []
  for (const q of range(n - 1))
    for (const j of others(i)) if (r.score[j][i][q] >= ESCALATION && positive(q + 1) > 0) shares.push(Math.max(0, r.score[i][j][q + 1]) / positive(q + 1))

  let opp = 0
  let joined = 0
  for (const q of range(n - 1))
    for (const j of others(i)) {
      const thirdParty = BLOCS.some((k) => k !== i && k !== j && r.score[k][j][q] >= ESCALATION)
      const provokedByJ = r.score[j][i][q] >= ESCALATION || (q > 0 && r.score[j][i][q - 1] >= ESCALATION)
      if (!thirdParty || provokedByJ) continue
      opp++
      if (r.score[i][j][q + 1] >= POSTURING) joined++
    }

  const ind = indicatorsByQuarter(events)
  let pos = 0
  let atComparator = 0
  for (const q of range(n)) {
    const seen = ind[q - 1] ?? ind[0] // 결정 때 본 직전 분기 결과 (첫 분기는 1분기 결과로 근사: 순위가 거의 바뀌지 않는다)
    if (!seen) continue
    const cmp = largestOther(seen, i)
    pos += positive(q)
    atComparator += Math.max(0, r.score[i][cmp][q])
  }

  return {
    actor: i,
    objective,
    total: others(i).reduce((a, j) => a + r.score[i][j].reduce((b, x) => b + x, 0), 0),
    escalations,
    firstEscalation: s.firstEscalation,
    firstMover: s.firstMover,
    unprovoked,
    retaliationRate: s.retaliationRate,
    reciprocityRate: s.reciprocityRate,
    forgivenessRate: s.forgivenessRate,
    strategy: s.strategy, // 분기별 최댓값 계열로 정해도 쌍 단위와 같은 판정이다 (확전 0회 ⇔, 이유 없는 확전 0회 ⇔)
    retaliationTargeting: shares.length ? shares.reduce((a, x) => a + x, 0) / shares.length : NaN,
    bandwagonRate: ratio(joined, opp),
    comparatorShare: ratio(atComparator, pos),
    publicThreats: r.publicThreats[i].reduce((a, x) => a + x, 0),
  }
}

// 게임에서 가장 먼저 확전한 (분기, 행위국, 대상국). 같은 분기에 여럿이면 모두
export function firstEscalations(r: EscalationRecord): { quarter: number; actor: BlocId; target: BlocId }[] {
  for (const q of range(r.quarters)) {
    const hits = BLOCS.flatMap((i) => others(i).filter((j) => r.score[i][j][q] >= ESCALATION).map((j) => ({ quarter: q, actor: i, target: j })))
    if (hits.length) return hits
  }
  return []
}

// ── 블록 형성: 그 분기에 유효한 약속으로 이어진 나라들 (약속의 의무국 — 대상국을 잇는 연결 성분) ──
export function blocsByQuarter(events: GameEvent[]): BlocId[][][] {
  const cms = events.flatMap((e) => (e.type === 'quarter' ? e.newCommitments : []))
  const n = events.filter((e) => e.type === 'quarter').length
  return range(n).map((q) => {
    const parent = Object.fromEntries(BLOCS.map((b) => [b, b])) as Record<BlocId, BlocId>
    const find = (x: BlocId): BlocId => (parent[x] === x ? x : (parent[x] = find(parent[x])))
    for (const c of cms) if (c.startQuarter <= q && q <= c.endQuarter) for (const t of c.toward) parent[find(c.obligor)] = find(t)
    const groups = new Map<BlocId, BlocId[]>()
    for (const b of BLOCS) groups.set(find(b), [...(groups.get(find(b)) ?? []), b])
    return [...groups.values()].filter((g) => g.length >= 2)
  })
}

// 블록 안팎 관세 차이: 회원국이 바깥 나라에 매기는 평균 관세 − 안쪽 나라에 매기는 평균 관세 (%p, 회원국 평균)
// 2023년 대비 변화로 잰다 (시작 관세가 상대마다 달라서). 6개국 모두가 한 블록이면 바깥이 없어 NaN
export function blocTariffGap(policies: Record<RegionId, Policy>, members: BlocId[]): number {
  const base = statusQuoPolicies()
  const outside = BLOCS.filter((b) => !members.includes(b))
  if (!outside.length || members.length < 2) return NaN
  const delta = (i: BlocId, j: BlocId) => avgTariffPct(policies[i], j) - avgTariffPct(base[i], j)
  const avg = (xs: number[]) => xs.reduce((a, x) => a + x, 0) / xs.length
  return avg(members.map((i) => avg(outside.map((j) => delta(i, j))) - avg(members.filter((j) => j !== i).map((j) => delta(i, j)))))
}

// ── 상대국 차별: 한 나라가 상대별로 관세를 얼마나 다르게 바꿨나 ──
// 2023년 대비 상대별 평균 관세 변화(%p)의 최댓값 − 최솟값. 모두에게 같이 올리거나 내리면 0
export function discrimination(policies: Record<RegionId, Policy>, i: BlocId): number {
  const base = statusQuoPolicies()
  const d = others(i).map((j) => avgTariffPct(policies[i], j) - avgTariffPct(base[i], j))
  return Math.max(...d) - Math.min(...d)
}

// 2023년보다 강한 수출 통제를 건 (상대, 물품) 수
export function controlsAboveBase(policies: Record<RegionId, Policy>, i: BlocId): number {
  const base = statusQuoPolicies()
  return others(i).reduce((a, j) => a + policies[i].exportControls[j].filter((x, g) => x > base[i].exportControls[j][g]).length, 0)
}

// ── 말과 행동 ──
export interface WordsDeeds {
  actor: BlocId
  twoFaced: number // 같은 분기 같은 상대에게 협력 어조 비공개 메시지를 보내면서 확전 (정책 점수 12 이상)
  publicTwoFaced: number // 협력 어조 공개 성명을 낸 분기에 누구에게든 확전
  threats: number // 비공개 위협 (상대, 분기)
  threatsCarriedOut: number // 위협한 분기부터 2분기 안에 그 상대에게 정책 점수 12 이상
  warnings: number // 경고 어조 (상대, 분기)
  warningsCarriedOut: number
}

export function wordsAndDeeds(events: GameEvent[], r: EscalationRecord, i: BlocId): WordsDeeds {
  const tone = new Map<string, Set<string>>() // `${q}:${to}` → 어조들
  const add = (q: number, to: string, t: string) => tone.set(`${q}:${to}`, new Set([...(tone.get(`${q}:${to}`) ?? []), t]))
  for (const e of events) {
    if ((e.type !== 'diplomacy' && e.type !== 'decision') || e.country !== i) continue
    if (e.action.statement?.text?.trim()) add(e.quarter, 'all', e.action.statement.tone)
    for (const m of e.action.messages ?? []) if (m.text?.trim()) add(e.quarter, m.to, m.tone)
  }
  const has = (q: number, to: string, t: string) => tone.get(`${q}:${to}`)?.has(t) ?? false
  const escalated = (j: BlocId, q: number) => policyScore(r, i, j, q) >= ESCALATION
  const out: WordsDeeds = { actor: i, twoFaced: 0, publicTwoFaced: 0, threats: 0, threatsCarriedOut: 0, warnings: 0, warningsCarriedOut: 0 }
  for (const q of range(r.quarters)) {
    if (has(q, 'all', 'cooperative') && others(i).some((j) => escalated(j, q))) out.publicTwoFaced++
    for (const j of others(i)) {
      if (has(q, j, 'cooperative') && escalated(j, q)) out.twoFaced++
      const carried = [q, q + 1, q + 2].some((x) => x < r.quarters && escalated(j, x))
      if (has(q, j, 'threat')) {
        out.threats++
        if (carried) out.threatsCarriedOut++
      }
      if (has(q, j, 'warning')) {
        out.warnings++
        if (carried) out.warningsCarriedOut++
      }
    }
  }
  return out
}
