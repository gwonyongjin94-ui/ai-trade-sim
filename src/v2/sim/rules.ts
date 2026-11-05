// v2 규칙 기반 지도자. LLM 결과를 해석할 때 쓰는 비교 기준이다 (v1 src/sim/rules.ts를 상대국별로 넓힘).
//  - status-quo: 2023년 정책 유지. 외교에 반응하지 않는다
//  - free-trade: AI 5개국에 관세 0%, 통제 없음. 받은 제안은 모두 수락. 1년마다 5개국 모두에게 상호 무관세를 제안한다
//  - tit-for-tat: 상대국마다 따로 따라 한다. 상대가 우리 물품 관세를 2023년보다 올리거나 내린 만큼 우리도 그 나라 같은 물품 관세를 바꾼다.
//    시작 관세가 나라마다 달라서 값 자체가 아니라 2023년 대비 변화를 따라 한다. 상대가 2023년보다 강한 수출 통제를 걸면
//    그 나라로 가는 우리 최대 수출품에 같은 단계를 건다
//  - provocateur: 정해진 자극. 3분기에 AI 블록 중 최대 수입원 한 나라의 전 품목 관세를 2023년보다 25%p 올리고 끝까지 유지한다.
//    다른 지도자들이 같은 도발에 어떻게 반응하는지(보복·조준·편승)를 비교하려는 선택 조건이다 (사용자 결정 ④, 기본 실험에는 넣지 않음)

import type { Tone } from '../diplomacy'
import { BLOCS } from '../regions'
import type { BlocId } from '../regions'
import { TRADED } from '../sectors'
import type { ExportLevel, Policy } from '../types'
import { TARIFF_MAX } from '../types'
import { clonePolicy, statusQuoPolicies } from '../world'
import { keepPolicyAction, partnersOf, silentDiplomacy } from './game'
import type { DecisionAction, DiplomacyAction, Leader, Observation, OutgoingMessage } from './types'

export type RuleKind = 'free-trade' | 'status-quo' | 'tit-for-tat' | 'provocateur'

export const RULE_LABEL: Record<RuleKind, string> = {
  'free-trade': '자유무역',
  'status-quo': '현상 유지',
  'tit-for-tat': '팃포탯',
  provocateur: '도발자',
}

export const PROVOKE_QUARTER = 2 // 0부터 센다 = 1년차 3분기
export const PROVOKE_PP = 25

const BASE = statusQuoPolicies()
const round = (x: number) => Math.round(x * 1000) / 1000
const sum = (xs: number[]) => xs.reduce((a, x) => a + x, 0)

function decision(p: Policy, self: BlocId, accept: string[] = [], messages: OutgoingMessage[] = [], statement = '', tone: Tone = 'neutral'): DecisionAction {
  return { ...keepPolicyAction(p, self, statement, tone), acceptProposals: accept, messages }
}

export class RuleLeader implements Leader {
  kind = 'rule' as const
  label: string
  private rule: RuleKind
  private target: BlocId | null = null

  constructor(rule: RuleKind) {
    this.rule = rule
    this.label = `rule:${rule}`
  }

  async diplomacy(obs: Observation): Promise<{ action: DiplomacyAction }> {
    if (this.rule === 'free-trade' && obs.quarter % 4 === 0) {
      return {
        action: {
          statement: { text: '모든 나라에 서로 관세를 0%로 두고 수출 통제를 하지 않을 것을 제안한다.', tone: 'cooperative' },
          messages: [],
          proposals: [
            {
              to: partnersOf(obs.country),
              terms: [
                { obligor: 'all', kind: 'tariff_max', goods: ['all'], value: 0 },
                { obligor: 'all', kind: 'export_control_max', goods: ['all'], value: 0 },
              ],
              durationQuarters: 4,
              note: '상호 자유무역',
            },
          ],
        },
      }
    }
    return { action: silentDiplomacy() }
  }

  async decide(obs: Observation): Promise<{ action: DecisionAction }> {
    const c = obs.country
    const own = obs.policies[c]
    switch (this.rule) {
      case 'status-quo':
        return { action: decision(own, c) }
      case 'free-trade': {
        const p = clonePolicy(own)
        for (const j of partnersOf(c)) {
          p.tariffs[j] = TRADED.map(() => 0)
          p.exportControls[j] = TRADED.map(() => 0 as ExportLevel)
        }
        return { action: decision(p, c, obs.pendingProposals.map((x) => x.id)) }
      }
      case 'provocateur': {
        if (obs.quarter < PROVOKE_QUARTER) return { action: decision(own, c) }
        const target = this.target ?? partnersOf(c).reduce((best, j) => (sum(obs.flows[j][c]) > sum(obs.flows[best][c]) ? j : best))
        this.target = target
        const p = clonePolicy(own)
        p.tariffs[target] = BASE[c].tariffs[target].map((t) => round(Math.min(TARIFF_MAX, t + PROVOKE_PP / 100)))
        const messages: OutgoingMessage[] =
          obs.quarter === PROVOKE_QUARTER ? [{ to: target, text: '귀국 물품에 대한 관세를 올린다. 이 조치는 유지된다.', tone: 'warning' }] : []
        return { action: decision(p, c, [], messages) }
      }
      case 'tit-for-tat': {
        const p = clonePolicy(own)
        const messages: OutgoingMessage[] = []
        for (const j of BLOCS) {
          if (j === c) continue
          const theirs = obs.policies[j]
          p.tariffs[j] = TRADED.map((_, g) => round(Math.max(0, Math.min(TARIFF_MAX, BASE[c].tariffs[j][g] + theirs.tariffs[c][g] - BASE[j].tariffs[c][g]))))
          p.exportControls[j] = [...BASE[c].exportControls[j]]
          const worst = Math.max(0, ...TRADED.map((_, g) => (theirs.exportControls[c][g] > BASE[j].exportControls[c][g] ? theirs.exportControls[c][g] : 0))) as ExportLevel
          if (worst > 0) {
            const flows = obs.flows[c][j]
            const top = flows.reduce((best, v, g) => (v > flows[best] ? g : best), 0)
            p.exportControls[j][top] = Math.max(p.exportControls[j][top], worst) as ExportLevel
          }
          const raised = worst > 0 || TRADED.some((_, g) => p.tariffs[j][g] > BASE[c].tariffs[j][g] + 1e-9)
          if (raised) messages.push({ to: j, text: '귀국의 조치에 같은 수준으로 대응한다. 귀국이 완화하면 우리도 완화한다.', tone: 'warning' })
        }
        return { action: decision(p, c, [], messages) }
      }
    }
  }
}
