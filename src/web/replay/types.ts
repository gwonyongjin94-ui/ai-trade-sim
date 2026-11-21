// AI 지도자 리플레이 파일 형식 (scripts/export-replay.ts가 runs/의 실험 기록에서 만든다 → public/replays/)
import type { BlocId, RegionId } from '../../v2/regions'

export type Tone = 'cooperative' | 'neutral' | 'warning' | 'threat'
export type ReplayKind = 'llm' | 'rule' | 'mock'

export interface ReplayIndexEntry {
  id: string
  title: string
  kind: ReplayKind
  note: string
  quarters: number
}

export interface ReplayBloc {
  statements: { round: 1 | 2; text: string; tone: Tone }[] // 공개 성명
  messages: { round: 1 | 2; to: BlocId; text: string; tone: Tone }[] // 비공개 메시지
  proposals: { id: string; to: BlocId[]; terms: string[]; note: string; duration: number }[]
  accepted: string[] // 수락한 제안 id
  changes: string[] // 정책 변화 (사람이 읽는 문장)
  changeCount: number
  thinking: string // 외교 단계 비공개 판단
  reasoning: string // 결정 이유 (비공개)
  clamped: string[]
}

export interface ReplayQuarter {
  q: number
  blocs: Record<BlocId, ReplayBloc>
  es: { from: BlocId; to: BlocId; score: number; items: string[] }[] // 누가 누구에게 확전점수 (0이 아닌 것만)
  newCommitments: { id: string; obligor: BlocId; toward: BlocId[]; text: string }[]
  violations: { id: string; obligor: BlocId; first: boolean; text: string }[]
  active: [BlocId, BlocId][] // 이번 분기에 유효한 약속으로 묶인 쌍 (중복 없이)
  ind: Record<RegionId, { livingStandard: number; realGdp: number; nominalGdpUsd: number; exports: number; imports: number }>
  ratio: Record<BlocId, number>
  anomalies: { country: BlocId | null; kind: string; detail: string }[]
}

export interface ReplayActor {
  strategy: string
  given: number // 준 확전점수 합
  received: number
  escalations: number
  retaliationRate: number | null
  firstEscalation: number | null
  objective: string
  score: number | null // 임기 목표 점수
  startScore: number | null
}

export interface ReplayFile {
  id: string
  title: string
  kind: ReplayKind
  note: string
  leaders: Record<BlocId, string>
  config: { years: number; naming: string; culture: string; recap: string; objectives: Record<BlocId, string> }
  source: { run: string; commit: string | null; startedAt: string | null }
  quarters: ReplayQuarter[]
  totals: { es: Record<BlocId, Record<BlocId, number>>; actors: Record<BlocId, ReplayActor> }
}
