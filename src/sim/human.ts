// 사람 대통령. 게임이 물어보면 화면이 답을 넣어 준다.
// 실시간 모드에서 마감이 지나면 게임이 현재 정책 유지로 처리하고 onTimeout을 부른다.

import type { DecisionAction, DiplomacyAction, Leader, Observation } from './types'

export type HumanPrompt =
  | { round: 1; obs: Observation; resolve: (a: DiplomacyAction) => void }
  | { round: 2; obs: Observation; rivalMessage: DiplomacyAction; resolve: (a: DecisionAction) => void }

export class HumanLeader implements Leader {
  kind = 'human' as const
  label = 'human'
  pending: HumanPrompt | null = null
  private listeners = new Set<() => void>()

  subscribe(cb: () => void) {
    this.listeners.add(cb)
    return () => {
      this.listeners.delete(cb)
    }
  }

  private notify() {
    for (const cb of this.listeners) cb()
  }

  diplomacy(obs: Observation) {
    return new Promise<{ action: DiplomacyAction }>((res) => {
      this.pending = { round: 1, obs, resolve: (action) => res({ action }) }
      this.notify()
    })
  }

  decide(obs: Observation, rivalMessage: DiplomacyAction) {
    return new Promise<{ action: DecisionAction }>((res) => {
      this.pending = { round: 2, obs, rivalMessage, resolve: (action) => res({ action }) }
      this.notify()
    })
  }

  submitDiplomacy(a: DiplomacyAction) {
    if (this.pending?.round !== 1) return
    const p = this.pending
    this.pending = null
    p.resolve(a)
    this.notify()
  }

  submitDecision(a: DecisionAction) {
    if (this.pending?.round !== 2) return
    const p = this.pending
    this.pending = null
    p.resolve(a)
    this.notify()
  }

  onTimeout() {
    this.pending = null
    this.notify()
  }
}
