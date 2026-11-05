import type { CultureBrief } from '../engine/culture'
import type { Commitment, Proposal, ProposalTerm, Tone, Violation } from '../engine/diplomacy'
import type { GoodId, Naming } from '../engine/goods'
import type { EsAction } from '../engine/hostility'
import type { ObjectiveKind } from '../engine/objectives'
import type { CountryId, ExportLevel, Indicators, Policy } from '../engine/types'

// 지난 분기 실제 변화 알려주기 (실험 조건). 로컬 시험판(2026-11-03)에서 대통령이 자기가 실제로 한 일을
// 반대로 알고 있었다 (수출 통제를 올리고 "완화했다"고 메모). 실제 기록을 알려주면 알아채고 고치는지 본다.
export type Recap = 'on' | 'off'
export const RECAP_LABEL: Record<Recap, string> = { off: '알려주지 않음', on: '실제 변화 알려줌' }
// 대통령 관측에 확전점수를 보여줄지. 확전점수는 연구자의 측정값인데, 보이면 벌점처럼 읽혀 행동을 누를 수 있다
// (Haiku 시험판 2026-11-05: "확전 점수를 불러 GDP 비율에 불리"). Rivera 외는 사후에만 계산한다
export type EsView = 'shown' | 'hidden'
export const ES_VIEW_LABEL: Record<EsView, string> = { shown: '확전점수 보임', hidden: '확전점수 숨김' }

export interface GameConfig {
  years: number // 기본 12년 = 대통령 3명
  termYears: number // 4년 단임 교체
  objectives: Record<CountryId, ObjectiveKind>
  naming: Naming
  culture: CultureBrief // LLM 대통령 프롬프트에 두 나라 문화 설명을 넣을지 (경제 수치의 문화 차이는 항상 있음)
  recap?: Recap // LLM 대통령에게 지난 분기 자기 나라의 실제 정책 변화를 알려줄지 (없으면 off)
  esView?: EsView // LLM 대통령 관측에 확전점수를 보여줄지 (없으면 shown, 이 조건을 넣기 전 런)
  realtime: { secondsPerYear: number } | null // null = 빠르게 (배치 실험)
}

export const DEFAULT_CONFIG: GameConfig = {
  years: 12,
  termYears: 4,
  objectives: { A: 'absolute', B: 'absolute' },
  naming: 'real',
  culture: 'shown',
  recap: 'off',
  realtime: null,
}

export interface PresidentInfo {
  number: number // 몇 대 대통령
  termQuarter: number // 임기 몇 번째 분기 (1부터)
  quartersLeft: number // 이번 분기 포함 남은 분기
  objective: ObjectiveKind
}

export interface HistoryRow {
  quarter: number
  A: { livingStandard: number; realGdp: number; capital: number; inflation: number; avgTariff: number; es: number; shortage: number }
  B: { livingStandard: number; realGdp: number; capital: number; inflation: number; avgTariff: number; es: number; shortage: number }
}

export interface MessageRecord {
  quarter: number
  round: 1 | 2
  from: CountryId
  text: string
  tone: Tone
}

export interface Observation {
  country: CountryId
  quarter: number // 0부터
  totalQuarters: number
  naming: Naming
  president: PresidentInfo
  rivalPresidentNumber: number
  rivalPresidentIsNew: boolean
  latest: Record<CountryId, Indicators> | null // 직전 분기 결과 (첫 분기는 시작 상태)
  policies: Record<CountryId, Policy>
  trade: { good: GoodId; exports: number; imports: number; importDependence: number }[]
  history: HistoryRow[]
  commitments: Commitment[] // 현재 유효하거나 앞으로 유효한 약속
  violations: Violation[] // 최근 8분기
  messages: MessageRecord[] // 최근 2분기 + 이번 분기
  pendingProposals: Proposal[] // 상대가 이번 분기 제안한 것 (2라운드에서만)
  memoToSelf: string
  handoverMemo: string | null // 새 대통령에게 전임자가 남긴 인수인계 메모
  recap: { quarter: number; score: number; actions: EsAction[] } | null // 지난 분기 우리나라가 실제로 한 일 (확전점수 항목, 게임의 물품 이름)
}

export interface DiplomacyAction {
  message: string
  tone: Tone
  proposals: { terms: ProposalTerm[]; durationQuarters: number; note: string }[]
  thinking?: string
}

export interface DecisionAction {
  message: string
  tone: Tone
  acceptProposals: string[]
  policy: { tariffsPct: Record<GoodId, number>; exportControls: Record<GoodId, ExportLevel>; investmentRatePct: number }
  reasoning: string
  memoToSelf: string
  handoverMemo: string
}

export interface LeaderCallMeta {
  model?: string // 실제 응답한 모델
  requestedModel?: string
  latencyMs?: number
  usage?: Record<string, number>
  stopReason?: string
  fallback?: boolean
  error?: string
  raw?: string
  prompt?: { system: string; user: string }
}

export interface Leader {
  kind: 'human' | 'rule' | 'llm'
  label: string // 로그·보고서용 (예: claude-opus-5-5, rule:tit-for-tat, human)
  diplomacy(obs: Observation): Promise<{ action: DiplomacyAction; meta?: LeaderCallMeta }>
  decide(obs: Observation, rivalMessage: DiplomacyAction): Promise<{ action: DecisionAction; meta?: LeaderCallMeta }>
  newTerm?(country: CountryId, president: number): void
  onTimeout?(): void // 실시간 마감을 넘겨 기본 행동으로 처리됐을 때 (사람)
}

// ── 로그 이벤트 (배치 실험에서는 JSONL 한 줄 = 이벤트 하나) ──
export type GameEvent =
  | { type: 'start'; config: GameConfig; leaders: Record<CountryId, string>; startedAt: string }
  | { type: 'diplomacy'; quarter: number; country: CountryId; action: DiplomacyAction; proposals: Proposal[]; meta?: LeaderCallMeta }
  | {
      type: 'decision'
      quarter: number
      country: CountryId
      action: DecisionAction
      applied: Policy
      clamped: string[] // 범위를 벗어나 고친 값
      accepted: string[]
      meta?: LeaderCallMeta
    }
  | {
      type: 'quarter'
      quarter: number
      policies: Record<CountryId, Policy>
      indicators: Record<CountryId, Indicators>
      es: Record<CountryId, { score: number; cumulative: number; actions: EsAction[]; sudden: boolean }>
      posture: Record<CountryId, number>
      violations: Violation[]
      newCommitments: Commitment[]
      converged: boolean
    }
  | { type: 'term'; country: CountryId; president: number; objective: ObjectiveKind; fromQuarter: number; toQuarter: number; score: number; handoverMemo: string }
  | { type: 'anomaly'; quarter: number; country: CountryId | null; kind: string; detail: string }
  | { type: 'end'; finishedAt: string }

export interface QuarterRecord {
  quarter: number
  indicators: Record<CountryId, Indicators>
  policies: Record<CountryId, Policy>
  es: Record<CountryId, number>
  cumulativeEs: Record<CountryId, number>
  posture: Record<CountryId, number>
}
