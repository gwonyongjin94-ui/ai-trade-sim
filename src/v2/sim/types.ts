// v2 게임 층의 형식. v1(src/sim/types.ts)을 6개국 다자 외교로 넓혔다.
// 확전점수는 지도자에게 보여 주지 않고 기록에서 사후에 계산한다 (v1 Haiku 시험판에서 벌점처럼 읽혔다).

import type { LeaderCallMeta, Recap } from '../../sim/types'
import type { CultureBrief } from '../culture'
import type { Commitment, Proposal, RawProposal, Tone, Violation } from '../diplomacy'
import type { ObjectiveKind } from '../objectives'
import type { PolicyChange } from '../policy'
import type { BlocId, RegionId, RegionNaming } from '../regions'
import type { ExportLevel, Indicators, Policy } from '../types'

export type { LeaderCallMeta, Recap } from '../../sim/types'
export { RECAP_LABEL } from '../../sim/types'

export interface GameConfig {
  years: number // 기본 4년 = 한 판에 지도자 1명 (docs/V2_DESIGN.md)
  termYears: number
  objectives: Record<BlocId, ObjectiveKind>
  naming: RegionNaming // 나라 이름: 실제 이름 / A~F. 물품 이름과 경제 수치는 둘 다 실제다
  culture: CultureBrief // 지도자 프롬프트에 Hofstede 지표를 넣을지
  recap: Recap // 지난 분기 우리나라의 실제 정책 변화를 알려줄지
}

export const DEFAULT_CONFIG: GameConfig = {
  years: 4,
  termYears: 4,
  objectives: { A: 'absolute', B: 'absolute', C: 'absolute', D: 'absolute', E: 'absolute', F: 'absolute' },
  naming: 'real',
  culture: 'shown',
  recap: 'off',
}

export interface LeaderInfo {
  number: number // 몇 대 지도자
  termQuarter: number // 임기 몇 번째 분기 (1부터)
  quartersLeft: number // 이번 분기 포함 남은 분기
  objective: ObjectiveKind
}

export interface Message {
  quarter: number
  round: 1 | 2
  from: BlocId
  to: BlocId | 'all' // 'all' = 공개 성명
  text: string
  tone: Tone
}

export interface OutgoingMessage {
  to: BlocId
  text: string
  tone: Tone
}

export interface DiplomacyAction {
  statement: { text: string; tone: Tone } // 공개 성명 (모두가 본다). 빈 문자열이면 내지 않음
  messages: OutgoingMessage[] // 비공개 메시지 (받는 나라만 본다)
  proposals: RawProposal[]
  thinking?: string
}

// 정책은 상대 AI 블록별 × 교역재별. 키는 블록 id와 교역재 id
export interface PolicyInput {
  tariffsPct: Partial<Record<BlocId, Record<string, number>>>
  exportControls: Partial<Record<BlocId, Record<string, number>>>
  investmentRatePct: number
}

export interface DecisionAction {
  statement: { text: string; tone: Tone }
  messages: OutgoingMessage[]
  acceptProposals: string[]
  policy: PolicyInput
  reasoning: string
  memoToSelf: string
  handoverMemo: string
}

export interface HistoryRow {
  quarter: number
  blocs: Record<BlocId, { livingStandard: number; realGdp: number; nominalGdpUsd: number; capital: number; inflation: number; ratio: number }>
}

export interface Observation {
  country: BlocId
  quarter: number // 0부터
  totalQuarters: number
  naming: RegionNaming
  leader: LeaderInfo
  othersNew: boolean // 다른 나라 지도자도 이번 분기에 새로 취임했는지 (모두 같은 임기 일정)
  start: Record<RegionId, Indicators>
  latest: Record<RegionId, Indicators> // 직전 분기 결과 (첫 분기는 시작 상태)
  policies: Record<RegionId, Policy> // 현재 정책 (모든 나라 공개)
  flows: Record<RegionId, Record<RegionId, number[]>> // 직전 분기 물품별 교역 [수출][수입][교역재], 연율 10억 달러
  history: HistoryRow[] // 최근 8분기
  commitments: Commitment[] // 지금 또는 앞으로 유효한 약속 (모두 공개)
  violations: Violation[] // 최근 8분기
  messages: Message[] // 우리가 볼 수 있는 메시지 (공개 성명 + 우리가 주고받은 비공개 메시지), 최근 2분기 + 이번 분기
  pendingProposals: Proposal[] // 이번 분기 우리에게 온 제안 (2라운드에서만)
  ownProposals: Proposal[] // 이번 분기 우리가 보낸 제안 (2라운드에서만)
  memoToSelf: string
  handoverMemo: string | null
  recap: { quarter: number; changes: PolicyChange[] } | null // 지난 분기 우리나라의 실제 정책 변화
}

export interface Leader {
  kind: 'human' | 'rule' | 'llm'
  label: string
  diplomacy(obs: Observation): Promise<{ action: DiplomacyAction; meta?: LeaderCallMeta }>
  decide(obs: Observation): Promise<{ action: DecisionAction; meta?: LeaderCallMeta }> // 이번 분기 1라운드 메시지·제안은 obs에 들어 있다
  newTerm?(country: BlocId, leader: number): void
}

export type GameEvent =
  | { type: 'start'; version: 2; config: GameConfig; leaders: Record<BlocId, string>; policies: Record<RegionId, Policy>; startedAt: string }
  | { type: 'diplomacy'; quarter: number; country: BlocId; action: DiplomacyAction; proposals: Proposal[]; dropped: string[]; meta?: LeaderCallMeta }
  | {
      type: 'decision'
      quarter: number
      country: BlocId
      action: DecisionAction
      applied: Policy
      changes: PolicyChange[]
      clamped: string[]
      accepted: string[]
      dropped: string[]
      meta?: LeaderCallMeta
    }
  | {
      type: 'quarter'
      quarter: number
      policies: Record<RegionId, Policy>
      indicators: Record<RegionId, Indicators>
      ratio: Record<BlocId, number> // 명목 GDP 비율 (%)
      violations: Violation[]
      newCommitments: Commitment[]
      converged: boolean
    }
  | {
      type: 'term'
      country: BlocId
      leader: number
      objective: ObjectiveKind
      fromQuarter: number
      toQuarter: number
      score: number
      startScore: number // 임기 시작 직전 상태의 같은 지표 (절대 이익은 100)
      handoverMemo: string
    }
  | { type: 'anomaly'; quarter: number; country: BlocId | null; kind: string; detail: string }
  | { type: 'end'; finishedAt: string }

export type { ExportLevel }
