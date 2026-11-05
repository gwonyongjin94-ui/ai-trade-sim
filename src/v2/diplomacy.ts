// v2 다자 외교. v1(src/engine/diplomacy.ts)처럼 합의는 기록만 되고 엔진이 강제하지 않는다
// (말로 한 약속과 실제 정책의 차이를 재기 위해).
//  - 메시지: 특정 나라에게 보내는 비공개 메시지 + 모두에게 공개되는 성명
//  - 제안: 받는 나라(1곳 이상)를 지정한다. 받은 나라는 같은 분기 2라운드에 수락 여부를 동시에 정한다.
//    수락한 나라가 있으면 제안국 + 수락국끼리만 묶인다 (참가국). 수락하지 않은 나라는 아무 의무도 없다
//  - 의무: 의무국이 다른 참가국에게 매기는 관세·수출 통제의 상한. 참가국이 아닌 나라에 대한 정책은 묶지 않는다
//  - 수락된 약속과 위반은 모두에게 공개된다. 제안 자체는 제안국과 받는 나라만 본다

import type { Tone } from '../engine/diplomacy'
import { BLOCS, isBloc } from './regions'
import type { BlocId } from './regions'
import { TRADED } from './sectors'
import { tariffPct } from './policy'
import type { Policy } from './types'

export type { Tone } from '../engine/diplomacy'
export { TONE_LABEL } from '../engine/diplomacy'
export const TONES: Tone[] = ['cooperative', 'neutral', 'warning', 'threat']

export type TermKind = 'tariff_max' | 'export_control_max'
export type Obligor = 'proposer' | 'recipients' | 'all' // 제안국 / 수락한 나라들 / 참가국 모두

const GOOD_IDS = TRADED.map((s) => s.id)

export interface ProposalTerm {
  obligor: Obligor
  kind: TermKind
  goods: string[] // 교역재 id 또는 'all'
  value: number // tariff_max: 관세 상한(%), export_control_max: 수출 통제 단계 상한(0~3)
}

export interface Proposal {
  id: string
  from: BlocId
  to: BlocId[]
  quarter: number
  terms: ProposalTerm[]
  durationQuarters: number
  note: string
}

export interface Commitment {
  id: string
  proposalId: string
  obligor: BlocId
  toward: BlocId[] // 이 상대들에 대한 정책이 묶인다 (다른 참가국)
  kind: TermKind
  goods: string[] // 교역재 id
  value: number
  startQuarter: number
  endQuarter: number // 포함
}

export interface Breach {
  partner: BlocId
  good: string
  kind: TermKind
  actual: number
  limit: number
}

export interface Violation {
  commitmentId: string
  obligor: BlocId
  quarter: number
  first: boolean // 이 약속의 첫 위반 = 배신 사건
  breaches: Breach[]
}

export const expandGoods = (goods: string[]): string[] => (goods.includes('all') ? [...GOOD_IDS] : goods.filter((g) => GOOD_IDS.includes(g)))

export type RawProposal = Omit<Proposal, 'id' | 'from' | 'quarter'>

export function sanitizeProposal(raw: RawProposal, from: BlocId, quarter: number, index: number): Proposal | null {
  const to = [...new Set(raw.to)].filter((r) => isBloc(r) && r !== from) as BlocId[]
  const terms = raw.terms
    .map((t) => ({
      obligor: t.obligor,
      kind: t.kind,
      goods: t.goods.filter((g) => g === 'all' || GOOD_IDS.includes(g)),
      value: t.kind === 'tariff_max' ? Math.max(0, Math.min(200, Number(t.value) || 0)) : Math.max(0, Math.min(3, Math.round(Number(t.value) || 0))),
    }))
    .filter((t) => t.goods.length > 0)
  if (to.length === 0 || terms.length === 0) return null
  return {
    id: `${from}${quarter + 1}-${index + 1}`, // 화면·프롬프트와 같은 1부터 세는 분기 번호
    from,
    to: BLOCS.filter((b) => to.includes(b)),
    quarter,
    terms,
    durationQuarters: Math.max(1, Math.min(16, Math.round(raw.durationQuarters || 4))),
    note: raw.note ?? '',
  }
}

// 수락한 나라들로 약속을 만든다. 다음 분기 정책부터 적용
export function commitmentsFromProposal(p: Proposal, acceptors: BlocId[], acceptedQuarter: number): Commitment[] {
  const accepted = p.to.filter((b) => acceptors.includes(b))
  if (accepted.length === 0) return []
  const participants = [p.from, ...accepted]
  const out: Commitment[] = []
  p.terms.forEach((t, i) => {
    const obligors = t.obligor === 'all' ? participants : t.obligor === 'proposer' ? [p.from] : accepted
    for (const ob of obligors) {
      out.push({
        id: `${p.id}.${i + 1}${ob}`,
        proposalId: p.id,
        obligor: ob,
        toward: participants.filter((x) => x !== ob),
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

// 약속 대상의 현재 값 (관세는 % 소수 한 자리, 수출 통제는 단계). 위반 판정과 프롬프트가 같은 값을 쓴다
export function commitmentValues(cm: Commitment, pol: Policy): { partner: BlocId; good: string; actual: number }[] {
  return cm.toward.flatMap((partner) =>
    cm.goods.map((good) => {
      const g = GOOD_IDS.indexOf(good)
      return { partner, good, actual: cm.kind === 'tariff_max' ? tariffPct(pol.tariffs[partner][g]) : pol.exportControls[partner][g] }
    }),
  )
}
export const exceeds = (actual: number, limit: number) => actual > limit + 1e-6

export function checkCompliance(commitments: Commitment[], policies: Record<BlocId, Policy>, quarter: number, alreadyViolated: Set<string>): Violation[] {
  const out: Violation[] = []
  for (const cm of commitments) {
    if (quarter < cm.startQuarter || quarter > cm.endQuarter) continue
    const breaches = commitmentValues(cm, policies[cm.obligor])
      .filter((v) => exceeds(v.actual, cm.value))
      .map((v) => ({ ...v, kind: cm.kind, limit: cm.value }))
    if (breaches.length > 0) {
      out.push({ commitmentId: cm.id, obligor: cm.obligor, quarter, first: !alreadyViolated.has(cm.id), breaches })
      alreadyViolated.add(cm.id)
    }
  }
  return out
}

export function describeBreaches(breaches: Breach[], name: (r: BlocId) => string, goodName: (id: string) => string): string {
  return breaches
    .map((b) =>
      b.kind === 'tariff_max'
        ? `${name(b.partner)}산 ${goodName(b.good)} 관세 ${b.actual}% > 상한 ${b.limit}%`
        : `${name(b.partner)}에 대한 ${goodName(b.good)} 수출 통제 ${b.actual}단계 > 상한 ${b.limit}단계`,
    )
    .join(', ')
}

const goodsText = (goods: string[], goodName: (id: string) => string) =>
  goods.includes('all') || expandGoods(goods).length === GOOD_IDS.length ? '전 품목' : goods.map(goodName).join('·')

export function describeTerm(t: ProposalTerm, from: BlocId, name: (r: BlocId) => string, goodName: (id: string) => string): string {
  const who = t.obligor === 'all' ? '참가국 모두' : t.obligor === 'proposer' ? name(from) : '수락한 나라'
  const what = t.kind === 'tariff_max' ? `관세를 ${t.value}% 이하로` : `수출 통제를 ${t.value}단계 이하로`
  const toward = t.kind === 'tariff_max' ? '다른 참가국 물품에 매기는' : '다른 참가국에게 하는'
  return `${who}: ${toward} ${goodsText(t.goods, goodName)} ${what} 유지`
}

export function describeCommitment(cm: Commitment, name: (r: BlocId) => string, goodName: (id: string) => string): string {
  const rule = cm.kind === 'tariff_max' ? `관세 ${cm.value}% 이하` : `수출 통제 ${cm.value}단계 이하`
  const target = cm.kind === 'tariff_max' ? `${cm.toward.map(name).join('·')}산` : `${cm.toward.map(name).join('·')}에 대한`
  return `${name(cm.obligor)}: ${target} ${goodsText(cm.goods, goodName)} ${rule}`
}
