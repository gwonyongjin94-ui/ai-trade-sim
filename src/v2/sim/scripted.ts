// 시험용 지도자: 정해진 분기에 정해진 일을 한다 (테스트 전용, 유료 호출 없음)

import { keepPolicyAction } from './game'
import type { DecisionAction, DiplomacyAction, Leader, Observation } from './types'

export class Scripted implements Leader {
  kind = 'rule' as const
  label = 'test:scripted'
  seen: { round: 1 | 2; obs: Observation }[] = []
  private dip: (obs: Observation) => Partial<DiplomacyAction>
  private dec: (obs: Observation, a: DecisionAction) => void

  constructor(dip: (obs: Observation) => Partial<DiplomacyAction> = () => ({}), dec: (obs: Observation, a: DecisionAction) => void = () => {}) {
    this.dip = dip
    this.dec = dec
  }

  async diplomacy(obs: Observation) {
    this.seen.push({ round: 1, obs })
    return { action: { statement: { text: '', tone: 'neutral' as const }, messages: [], proposals: [], ...this.dip(obs) } }
  }

  async decide(obs: Observation) {
    this.seen.push({ round: 2, obs })
    const a = keepPolicyAction(obs.policies[obs.country], obs.country)
    this.dec(obs, a)
    return { action: a }
  }
}
