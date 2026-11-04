// 규칙 기반 대통령. LLM 결과를 해석할 때 쓰는 비교 기준이다.
//  - free-trade: 관세 0%, 통제 없음. 모든 제안 수락. 상호 무관세를 제안한다
//  - status-quo: 시작 정책(관세 5%) 유지. 외교에 반응하지 않는다
//  - tit-for-tat: 상대의 직전 관세를 물품별로 그대로 따라 하고, 상대가 수출 통제를 걸면 우리 최대 수출품에 같은 단계를 건다
//  - nash: 엔진 수식으로 계산한 정적 내시 균형 관세를 첫 분기부터 쓴다 (무역전쟁 기준선)

import type { Tone } from '../engine/diplomacy'
import { GOODS } from '../engine/goods'
import { nashEquilibrium } from '../engine/nash'
import type { ObjectiveKind } from '../engine/objectives'
import { rival } from '../engine/types'
import type { CountryId, ExportLevel, Policy, World } from '../engine/types'
import { statusQuoPolicy } from '../engine/world'
import { keepPolicyAction } from './game'
import type { DecisionAction, DiplomacyAction, Leader, Observation } from './types'

export type RuleKind = 'free-trade' | 'status-quo' | 'tit-for-tat' | 'nash'

export const RULE_LABEL: Record<RuleKind, string> = {
  'free-trade': '자유무역',
  'status-quo': '현상 유지',
  'tit-for-tat': '팃포탯',
  nash: '내시 균형',
}

const silent: DiplomacyAction = { message: '', tone: 'neutral', proposals: [] }

function decision(p: Policy, message = '', tone: Tone = 'neutral', accept: string[] = []): DecisionAction {
  return { ...keepPolicyAction(p, message, tone), acceptProposals: accept }
}

// 정적 내시 관세는 계산에 몇 초가 걸리므로 목표별로 한 번만 계산한다
const nashCache = new Map<string, Record<CountryId, Policy>>()
export function staticNashPolicies(world: World, objectives: Record<CountryId, ObjectiveKind>): Record<CountryId, Policy> {
  const key = `${objectives.A}-${objectives.B}`
  if (!nashCache.has(key)) {
    const sq = { A: statusQuoPolicy(), B: statusQuoPolicy() }
    nashCache.set(key, nashEquilibrium(world, sq, { horizon: 1, objectives, groups: 'good' }).policies)
  }
  return nashCache.get(key)!
}

export class RuleLeader implements Leader {
  kind = 'rule' as const
  label: string
  private rule: RuleKind
  private nash: Policy | null

  constructor(rule: RuleKind, nashPolicy: Policy | null = null) {
    if (rule === 'nash' && !nashPolicy) throw new Error('nash 규칙에는 내시 정책이 필요하다')
    this.rule = rule
    this.label = `rule:${rule}`
    this.nash = nashPolicy
  }

  async diplomacy(obs: Observation): Promise<{ action: DiplomacyAction }> {
    if (this.rule === 'free-trade' && obs.quarter % 4 === 0) {
      return {
        action: {
          message: '양국 모두 전 품목 관세를 0%로 두고 수출 통제를 하지 않을 것을 제안한다.',
          tone: 'cooperative',
          proposals: [
            {
              terms: [
                { obligor: 'both', kind: 'tariff_max', goods: ['all'], value: 0 },
                { obligor: 'both', kind: 'export_control_max', goods: ['all'], value: 0 },
              ],
              durationQuarters: 4,
              note: '상호 자유무역',
            },
          ],
        },
      }
    }
    return { action: silent }
  }

  async decide(obs: Observation): Promise<{ action: DecisionAction }> {
    const own = obs.policies[obs.country]
    const other = obs.policies[rival(obs.country)]
    switch (this.rule) {
      case 'free-trade': {
        const p: Policy = { tariffs: GOODS.map(() => 0), exportControls: GOODS.map(() => 0 as ExportLevel), investmentRate: own.investmentRate }
        return { action: decision(p, '', 'cooperative', obs.pendingProposals.map((x) => x.id)) }
      }
      case 'status-quo':
        return { action: decision(own) }
      case 'nash':
        return { action: decision({ ...this.nash!, investmentRate: own.investmentRate }) }
      case 'tit-for-tat': {
        const sq = statusQuoPolicy()
        const tariffs = obs.quarter === 0 ? sq.tariffs : [...other.tariffs]
        const controls: ExportLevel[] = GOODS.map(() => 0)
        const worst = Math.max(...other.exportControls) as ExportLevel
        if (worst > 0) {
          // 우리 최대 수출품에 상대의 최고 통제 단계만큼 보복
          const top = obs.trade.reduce((best, t, g) => (t.exports > obs.trade[best].exports ? g : best), 0)
          controls[top] = worst
        }
        const retaliating = worst > 0 || other.tariffs.some((t, g) => t > own.tariffs[g] + 0.01)
        return {
          action: decision(
            { tariffs, exportControls: controls, investmentRate: own.investmentRate },
            retaliating ? '귀국의 조치에 같은 수준으로 대응한다. 귀국이 완화하면 우리도 완화한다.' : '',
            retaliating ? 'warning' : 'neutral',
          ),
        }
      }
    }
  }
}
