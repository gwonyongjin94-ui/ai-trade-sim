// 정책 실험: 2023년 정책에서 바꿀 것(변경 목록)을 받아 v2 엔진으로 16분기를 계산한다.
// 브라우저에서는 Web Worker(worker.ts)가 이 함수를 돌리고, 테스트는 같은 함수를 Node에서 돌려 실험 기록과 맞춘다.
// 규칙은 게임(src/v2/sim/game.ts)과 같다: q분기에 정한 정책이 그 분기 시장에 들어간다. 나머지 세계의 정책은 고정이다.

import nashJson from '../../data/v2-nash.json'
import { nominalRatio } from '../../v2/objectives'
import { BLOCS, perRegion, type BlocId, type RegionId } from '../../v2/regions'
import { TRADED } from '../../v2/sectors'
import { INVEST_MAX, INVEST_MIN, TARIFF_MAX, type ExportLevel, type Policy } from '../../v2/types'
import { clonePolicy, createWorld, statusQuoPolicies, stepQuarter } from '../../v2/world'

export const QUARTERS = 16

export type ChangeKind = 'tariffAdd' | 'tariffSet' | 'control' | 'invest'

// 한 가지 정책 변경. from분기(0부터)부터 끝까지 유지한다.
//  tariffAdd: 2023년 관세 + value(%p)   tariffSet: value(%)로   control: value단계로   invest: 투자율 value(%)로
export interface Change {
  kind: ChangeKind
  actor: BlocId
  partner: BlocId | 'all'
  good: string | 'all'
  value: number
  from: number
}

const BASE = statusQuoPolicies()
const GOOD_IDS = TRADED.map((s) => s.id)
// 0.1%p 단위 (게임의 applyDecision, 시작 정책과 같은 반올림)
const toGrid = (pct: number) => Math.round(pct * 10) / 1000
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

function apply(p: Record<RegionId, Policy>, c: Change) {
  const own = p[c.actor]
  if (c.kind === 'invest') {
    own.investmentRate = clamp(toGrid(c.value), INVEST_MIN, INVEST_MAX)
    return
  }
  const partners = c.partner === 'all' ? BLOCS.filter((b) => b !== c.actor) : c.partner === c.actor ? [] : [c.partner]
  const goods = c.good === 'all' ? GOOD_IDS.map((_, g) => g) : [GOOD_IDS.indexOf(c.good)].filter((g) => g >= 0)
  for (const j of partners)
    for (const g of goods) {
      if (c.kind === 'control') own.exportControls[j][g] = clamp(Math.round(c.value), 0, 3) as ExportLevel
      else {
        const pct = c.kind === 'tariffSet' ? c.value : BASE[c.actor].tariffs[j][g] * 100 + c.value
        own.tariffs[j][g] = toGrid(clamp(pct, 0, TARIFF_MAX * 100))
      }
    }
}

// q분기에 쓰는 정책: 2023년 정책에 from ≤ q인 변경을 목록 순서대로 덮어쓴다
export function policiesAt(changes: Change[], q: number): Record<RegionId, Policy> {
  const p = perRegion((r) => clonePolicy(BASE[r]))
  for (const c of changes) if (c.from <= q) apply(p, c)
  return p
}

export interface RegionOut {
  livingStandard: number
  welfare: number
  realGdp: number
  nominalGdpUsd: number
  exports: number // 10억 달러 (연율, 국경 가격)
  imports: number
  cpi: number
  shortage: number
  capital: number
  exportsTo: Record<RegionId, number>
}

export interface QuarterOut {
  q: number
  regions: Record<RegionId, RegionOut>
  ratio: Record<BlocId, number> // 명목 GDP 비율 (%)
  converged: boolean
}

export function simulate(changes: Change[], quarters = QUARTERS): QuarterOut[] {
  let world = createWorld()
  const out: QuarterOut[] = []
  for (let q = 0; q < quarters; q++) {
    const { world: next, result } = stepQuarter(world, policiesAt(changes, q))
    world = next
    const ind = result.indicators
    out.push({
      q,
      regions: perRegion((r) => ({
        livingStandard: ind[r].livingStandard,
        welfare: ind[r].welfare,
        realGdp: ind[r].realGdp,
        nominalGdpUsd: ind[r].nominalGdpUsd,
        exports: ind[r].exportsValue,
        imports: ind[r].importsValue,
        cpi: ind[r].cpi,
        shortage: ind[r].shortage,
        capital: ind[r].capital,
        exportsTo: { ...ind[r].exportsTo },
      })),
      ratio: Object.fromEntries(BLOCS.map((b) => [b, nominalRatio(ind, b)])) as Record<BlocId, number>,
      converged: result.market.converged,
    })
  }
  return out
}

// ---- 준비된 시나리오
type NashKind = 'absolute' | 'relative'
const NASH = (nashJson as unknown as { nash: Record<NashKind, { tariffsPct: Record<BlocId, Record<BlocId, number>> }> }).nash

const nashChanges = (k: NashKind): Change[] =>
  BLOCS.flatMap((a) => BLOCS.filter((b) => b !== a).map((b): Change => ({ kind: 'tariffSet', actor: a, partner: b, good: 'all', value: NASH[k].tariffsPct[a][b], from: 0 })))

export const PROVOKE_FROM = 2 // 1년차 3분기 (규칙 지도자 '도발자'와 같다)

export type PresetId = 'sq' | 'free' | 'provoke' | 'tradewar' | 'nash-a' | 'nash-r'

export const PRESETS: { id: PresetId; name: string; detail: string; changes: Change[] }[] = [
  { id: 'sq', name: '2023년 그대로', detail: '아무 정책도 바꾸지 않는다. 다른 시나리오를 비교하는 기준이다', changes: [] },
  {
    id: 'free',
    name: '자유무역',
    detail: 'AI 6개국이 1분기부터 서로 관세 0%, 수출 통제 없음. 나머지 세계와의 관세는 그대로',
    changes: BLOCS.flatMap((a): Change[] => [
      { kind: 'tariffSet', actor: a, partner: 'all', good: 'all', value: 0, from: 0 },
      { kind: 'control', actor: a, partner: 'all', good: 'all', value: 0, from: 0 },
    ]),
  },
  {
    id: 'provoke',
    name: '미국의 대중 관세 인상',
    detail: '미국이 1년차 3분기에 중국산 전 품목 관세를 2023년보다 25%p 올리고 유지한다 (규칙 지도자 "도발자"와 같은 조치)',
    changes: [{ kind: 'tariffAdd', actor: 'E', partner: 'B', good: 'all', value: 25, from: PROVOKE_FROM }],
  },
  {
    id: 'tradewar',
    name: '미중 맞관세',
    detail: '미국이 1년차 3분기에 중국산 전 품목 +25%p, 중국이 다음 분기에 미국산 전 품목 +25%p로 맞선다',
    changes: [
      { kind: 'tariffAdd', actor: 'E', partner: 'B', good: 'all', value: 25, from: PROVOKE_FROM },
      { kind: 'tariffAdd', actor: 'B', partner: 'E', good: 'all', value: 25, from: PROVOKE_FROM + 1 },
    ],
  },
  {
    id: 'nash-a',
    name: '내시 균형 (자국 후생)',
    detail: '각국이 자국 후생만 볼 때의 정적 내시 균형 관세(상대국마다 전 품목 같은 관세, 평균 11~24%)를 1분기부터 적용한다',
    changes: nashChanges('absolute'),
  },
  {
    id: 'nash-r',
    name: '내시 균형 (상대 GDP)',
    detail: '각국이 명목 GDP 비율(상대 이익)만 볼 때의 정적 내시 균형 관세(대부분 최대 200%)를 1분기부터 적용한다',
    changes: nashChanges('relative'),
  },
]

// ---- 주소(#)에 담기: [종류, 행위국, 상대, 물품, 값, 분기] 배열을 JSON → base64url
const KIND_CODE: Record<ChangeKind, string> = { tariffAdd: 'ta', tariffSet: 'ts', control: 'c', invest: 'i' }
const CODE_KIND = Object.fromEntries(Object.entries(KIND_CODE).map(([k, v]) => [v, k])) as Record<string, ChangeKind>

export function encodeChanges(cs: Change[]): string {
  const json = JSON.stringify(cs.map((c) => [KIND_CODE[c.kind], c.actor, c.partner, c.good, c.value, c.from]))
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeChanges(s: string): Change[] {
  try {
    const json = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
    const rows = JSON.parse(json) as unknown[]
    const ok: Change[] = []
    for (const r of rows) {
      if (!Array.isArray(r) || r.length !== 6) continue
      const [k, a, p, g, v, f] = r
      const kind = CODE_KIND[k]
      if (!kind || !BLOCS.includes(a) || !(p === 'all' || BLOCS.includes(p)) || !(g === 'all' || GOOD_IDS.includes(g))) continue
      if (!Number.isFinite(v) || !Number.isInteger(f) || f < 0 || f >= QUARTERS) continue
      ok.push({ kind, actor: a, partner: p, good: g, value: v, from: f })
    }
    return ok
  } catch {
    return []
  }
}
