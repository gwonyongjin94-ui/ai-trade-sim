// 화면 설정 → 게임 객체. 브라우저에서 돌리고, LLM 호출만 개발 서버(/api/llm)를 거친다.

import baselineJson from '../data/baseline.json'
import type { Naming } from '../engine/goods'
import type { CultureBrief } from '../engine/culture'
import type { ObjectiveKind } from '../engine/objectives'
import { COUNTRIES } from '../engine/types'
import type { CountryId } from '../engine/types'
import { createWorld } from '../engine/world'
import type { BaselineData, BenchmarkPath } from '../sim/baseline'
import { comboKey } from '../sim/baseline'
import { Game } from '../sim/game'
import { HumanLeader } from '../sim/human'
import { LlmLeader } from '../sim/llm'
import { httpTransport } from '../sim/llmTypes'
import type { Effort } from '../sim/llmTypes'
import { RULE_LABEL, RuleLeader } from '../sim/rules'
import type { RuleKind } from '../sim/rules'
import type { GameConfig, Leader, Recap } from '../sim/types'

export const baseline = baselineJson as unknown as BaselineData

export type Speed = 'realtime' | 'watch' | 'turn'
export const SPEED_LABEL: Record<Speed, string> = {
  realtime: '실시간 (현실 10분 = 1년, 분기 150초)',
  watch: '빠르게 관전 (분기 2초)',
  turn: '턴제 (모두 낼 때까지 기다림)',
}
const SECONDS_PER_YEAR: Record<Speed, number | null> = { realtime: 600, watch: 8, turn: null }

// 'human' | 'rule:<kind>' | 모델 id
export type Controller = string

export interface SetupState {
  A: { controller: Controller; objective: ObjectiveKind }
  B: { controller: Controller; objective: ObjectiveKind }
  naming: Naming
  culture: CultureBrief
  recap: Recap
  years: number
  speed: Speed
  effort: Effort
}

export interface Session {
  id: number
  setup: SetupState
  game: Game
  humans: Partial<Record<CountryId, HumanLeader>>
  references: { freeTrade: BenchmarkPath; nash: BenchmarkPath | null }
}

export function controllerLabel(c: Controller): string {
  if (c === 'human') return '사람'
  if (c.startsWith('rule:')) return `규칙: ${RULE_LABEL[c.slice(5) as RuleKind]}`
  return c
}

let nextId = 1
export function createSession(setup: SetupState): Session {
  const config: GameConfig = {
    years: setup.years,
    termYears: 4,
    objectives: { A: setup.A.objective, B: setup.B.objective },
    naming: setup.naming,
    culture: setup.culture,
    recap: setup.recap,
    realtime: SECONDS_PER_YEAR[setup.speed] ? { secondsPerYear: SECONDS_PER_YEAR[setup.speed]! } : null,
  }
  const nash = baseline.nash[comboKey(config.objectives)]
  const humans: Partial<Record<CountryId, HumanLeader>> = {}
  const leader = (c: CountryId): Leader => {
    const ctl = setup[c].controller
    if (ctl === 'human') return (humans[c] = new HumanLeader())
    if (ctl.startsWith('rule:')) {
      const rule = ctl.slice(5) as RuleKind
      return new RuleLeader(rule, rule === 'nash' ? nash.static!.policies[c] : null)
    }
    return new LlmLeader({
      model: ctl,
      transport: httpTransport,
      naming: config.naming,
      culture: config.culture,
      recap: config.recap,
      objective: config.objectives[c],
      country: c,
      termQuarters: config.termYears * 4,
      totalQuarters: config.years * 4,
      effort: setup.effort,
    })
  }
  const leaders = Object.fromEntries(COUNTRIES.map((c) => [c, leader(c)])) as Record<CountryId, Leader>
  const game = new Game(config, leaders, createWorld())
  return { id: nextId++, setup, game, humans, references: { freeTrade: baseline.freeTrade, nash: nash.dynamic ?? null } }
}
