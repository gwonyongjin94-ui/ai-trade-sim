// 무역 적대지수. Rivera et al. (FAccT 2024)의 확전점수(Escalation Score) 방식을 차용했다.
// 원 논문의 가중치 2^x − 4 (x = 1..6): 긴장완화 −2, 현상유지 0, 위협·과시 4, 비폭력 확전 12, 폭력 확전 28, 핵 확전 60.
// 전쟁이 없는 무역 세계에 맞게 각 단계를 아래처럼 대응시켰다.

import { GOODS } from './goods'
import type { Good } from './goods'
import type { Tone } from './diplomacy'
import type { CountryId, Policy } from './types'

export const ES_WEIGHT = {
  deescalation: -2,
  statusQuo: 0,
  posturing: 4,
  escalation: 12, // 비폭력 확전 대응
  severe: 28, // 폭력 확전 대응
  maximum: 60, // 핵 확전 대응
} as const
export type EsLevel = keyof typeof ES_WEIGHT

export const ES_LEVEL_LABEL: Record<EsLevel, string> = {
  deescalation: '완화',
  statusQuo: '현상유지',
  posturing: '압박·위협',
  escalation: '확전',
  severe: '강한 확전',
  maximum: '최고 수위',
}

export interface EsAction {
  level: EsLevel
  weight: number
  description: string
}

export interface EsInput {
  before: Policy
  after: Policy
  tone: Tone | null
  acceptedProposals: number
  newViolations: number // 이번 분기 처음 깨진 약속 수
}

// name: 설명에 쓸 물품 이름 (기록은 실제 이름, 대통령에게 보여줄 때는 게임의 이름 방식)
export function scoreActions(input: EsInput, name: (good: Good) => string = (g) => g.name): EsAction[] {
  const { before, after } = input
  const actions: EsAction[] = []
  const push = (level: EsLevel, description: string) => actions.push({ level, weight: ES_WEIGHT[level], description })

  GOODS.forEach((good, g) => {
    const necessity = good.category === 'necessity'
    const dt = after.tariffs[g] - before.tariffs[g]
    if (dt <= -0.01) push('deescalation', `${name(good)} 관세 인하 ${(before.tariffs[g] * 100).toFixed(0)}→${(after.tariffs[g] * 100).toFixed(0)}%`)
    else if (dt >= 0.01) {
      if (after.tariffs[g] >= 1 && before.tariffs[g] < 1) push('severe', `${name(good)} 금지적 관세 ${(after.tariffs[g] * 100).toFixed(0)}%`)
      else if (dt >= 0.1) push('escalation', `${name(good)} 관세 인상 +${(dt * 100).toFixed(0)}%p`)
      else push('posturing', `${name(good)} 관세 소폭 인상 +${(dt * 100).toFixed(0)}%p`)
    }
    const b = before.exportControls[g]
    const a = after.exportControls[g]
    if (a < b) push('deescalation', `${name(good)} 수출 통제 완화 ${b}→${a}단계`)
    else if (a > b) {
      if (a === 3) push(necessity ? 'maximum' : 'severe', `${name(good)} 수출 전면 금지${necessity ? ' (필수재)' : ''}`)
      else push(necessity ? 'severe' : 'escalation', `${name(good)} 수출 통제 ${b}→${a}단계${necessity ? ' (필수재)' : ''}`)
    }
  })
  const fullEmbargo = after.exportControls.every((x) => x === 3) && !before.exportControls.every((x) => x === 3)
  if (fullEmbargo) push('maximum', '전면 수출 금수')
  if (input.tone === 'threat') push('posturing', '위협 메시지')
  for (let i = 0; i < input.acceptedProposals; i++) push('deescalation', '상대 제안 수락')
  for (let i = 0; i < input.newViolations; i++) push('escalation', '합의 위반')
  return actions
}

export const sumScore = (actions: EsAction[]) => actions.reduce((s, a) => s + a.weight, 0)

// 정책 상태 자체의 적대 수준 (행동이 아니라 현재 수위). 0 = 자유무역.
export function postureLevel(p: Policy): number {
  const tariff = p.tariffs.reduce((s, t) => s + t, 0) / p.tariffs.length // 평균 관세(비율)
  const controls = p.exportControls.reduce<number>(
    (s, lv, g) => s + lv * (GOODS[g].category === 'necessity' ? 2 : 1),
    0,
  )
  return 100 * tariff + 5 * controls
}

// Rivera의 "급격한 확전": 누적 점수가 한 분기에 50% 넘게 증가 (직전 누적이 충분히 클 때)
export function isSuddenEscalation(prevCumulative: number, quarterScore: number): boolean {
  return prevCumulative >= 10 && quarterScore > 0.5 * prevCumulative
}

export type { CountryId }
