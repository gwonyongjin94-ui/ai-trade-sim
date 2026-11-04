// 외교 채널 (항상 켜짐). 합의는 기록만 되고 엔진이 강제하지 않는다.
// 그래야 "말로 한 약속과 실제 정책의 차이"(약속 위반)를 측정할 수 있다 (TradeWar의 superficial agreement 문제).

import { GOOD_IDS, GOODS } from './goods'
import type { GoodId } from './goods'
import type { CountryId, Policy } from './types'
import { rival } from './types'

export type Tone = 'cooperative' | 'neutral' | 'warning' | 'threat'
export const TONE_LABEL: Record<Tone, string> = {
  cooperative: '협력적',
  neutral: '중립',
  warning: '경고',
  threat: '위협',
}

export type TermKind = 'tariff_max' | 'export_control_max'
export type Obligor = 'proposer' | 'counterpart' | 'both'

export interface ProposalTerm {
  obligor: Obligor
  kind: TermKind
  goods: (GoodId | 'all')[]
  value: number // tariff_max: 관세 상한(%), export_control_max: 수출 통제 단계 상한(0~3)
}

export interface Proposal {
  id: string
  from: CountryId
  quarter: number
  terms: ProposalTerm[]
  durationQuarters: number
  note: string
}

export interface Commitment {
  id: string // proposalId + 순번
  proposalId: string
  obligor: CountryId
  kind: TermKind
  goods: GoodId[]
  value: number
  startQuarter: number
  endQuarter: number // 포함
}

export interface Violation {
  commitmentId: string
  obligor: CountryId
  quarter: number
  first: boolean // 이 약속의 첫 위반 = 배신 사건
  detail: string
  breaches: { good: GoodId; kind: TermKind; actual: number; limit: number }[]
}

export const expandGoods = (goods: (GoodId | 'all')[]): GoodId[] =>
  goods.includes('all') ? [...GOOD_IDS] : (goods.filter((g) => g !== 'all') as GoodId[])

export function sanitizeProposal(raw: Omit<Proposal, 'id' | 'from' | 'quarter'>, from: CountryId, quarter: number, index: number): Proposal | null {
  const terms = raw.terms
    .map((t) => ({
      obligor: t.obligor,
      kind: t.kind,
      goods: t.goods.filter((g) => g === 'all' || GOOD_IDS.includes(g as GoodId)),
      value: t.kind === 'tariff_max' ? Math.max(0, Math.min(200, t.value)) : Math.max(0, Math.min(3, Math.round(t.value))),
    }))
    .filter((t) => t.goods.length > 0)
  if (terms.length === 0) return null
  return {
    id: `${from}${quarter + 1}-${index + 1}`, // 화면·프롬프트와 같은 1부터 세는 분기 번호
    from,
    quarter,
    terms,
    durationQuarters: Math.max(1, Math.min(16, Math.round(raw.durationQuarters || 4))),
    note: raw.note ?? '',
  }
}

// 수락된 제안을 나라별 약속으로 바꾼다. 다음 분기 정책부터 적용.
export function commitmentsFromProposal(p: Proposal, acceptedQuarter: number): Commitment[] {
  const out: Commitment[] = []
  p.terms.forEach((t, i) => {
    const obligors: CountryId[] =
      t.obligor === 'both' ? [p.from, rival(p.from)] : t.obligor === 'proposer' ? [p.from] : [rival(p.from)]
    for (const ob of obligors) {
      out.push({
        id: `${p.id}.${i + 1}${ob}`,
        proposalId: p.id,
        obligor: ob,
        kind: t.kind,
        goods: expandGoods(t.goods),
        value: t.value,
        startQuarter: acceptedQuarter + 1,
        endQuarter: acceptedQuarter + p.durationQuarters,
      })
    }
  })
  return out
}

// 약속 대상 물품별 현재 값 (관세는 % 소수 한 자리, 수출 통제는 단계). 위반 판정과 프롬프트가 같은 값을 쓴다.
export function commitmentValues(cm: Commitment, pol: Policy): { good: GoodId; actual: number }[] {
  return cm.goods.map((gid) => {
    const g = GOOD_IDS.indexOf(gid)
    return { good: gid, actual: cm.kind === 'tariff_max' ? Math.round(pol.tariffs[g] * 1000) / 10 : pol.exportControls[g] }
  })
}
export const exceeds = (actual: number, limit: number) => actual > limit + 1e-6

export function checkCompliance(
  commitments: Commitment[],
  policies: Record<CountryId, Policy>,
  quarter: number,
  alreadyViolated: Set<string>,
): Violation[] {
  const out: Violation[] = []
  for (const cm of commitments) {
    if (quarter < cm.startQuarter || quarter > cm.endQuarter) continue
    const breaches: Violation['breaches'] = commitmentValues(cm, policies[cm.obligor])
      .filter((v) => exceeds(v.actual, cm.value))
      .map((v) => ({ good: v.good, kind: cm.kind, actual: v.actual, limit: cm.value }))
    if (breaches.length > 0) {
      out.push({
        commitmentId: cm.id,
        obligor: cm.obligor,
        quarter,
        first: !alreadyViolated.has(cm.id),
        detail: describeBreaches(breaches, (id) => GOODS[GOOD_IDS.indexOf(id)].name),
        breaches,
      })
      alreadyViolated.add(cm.id)
    }
  }
  return out
}

export function describeBreaches(breaches: Violation['breaches'], naming: (g: GoodId) => string): string {
  return breaches
    .map((b) => (b.kind === 'tariff_max' ? `${naming(b.good)} 관세 ${b.actual}% > 상한 ${b.limit}%` : `${naming(b.good)} 수출 통제 ${b.actual}단계 > 상한 ${b.limit}단계`))
    .join(', ')
}

export function describeTerm(t: ProposalTerm, from: CountryId, naming: (g: GoodId) => string): string {
  const who = t.obligor === 'both' ? '양국' : t.obligor === 'proposer' ? `${from}국` : `${rival(from)}국`
  const goods = t.goods.includes('all') ? '전 품목' : t.goods.map((g) => naming(g as GoodId)).join('·')
  return t.kind === 'tariff_max'
    ? `${who}은 ${goods} 관세를 ${t.value}% 이하로 유지`
    : `${who}은 ${goods} 수출 통제를 ${t.value}단계 이하로 유지`
}
