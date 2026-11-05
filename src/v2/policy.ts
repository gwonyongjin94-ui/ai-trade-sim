// 정책 읽기 도우미: 평균 관세, 분기 사이의 정책 변화 목록. 프롬프트(실제 변화 알려주기)와 기록·측정이 같은 값을 쓴다.
// 관세는 % 소수 한 자리로 비교한다 (지도자가 읽고 쓰는 단위). AI 블록끼리의 정책만 바뀔 수 있다 (나머지 세계와는 고정).

import { BLOCS } from './regions'
import type { BlocId } from './regions'
import { TRADED } from './sectors'
import type { Policy } from './types'

export const tariffPct = (t: number) => Math.round(t * 1000) / 10
export const ratePct = (x: number) => Math.round(x * 1000) / 10

// 물품 10개 단순 평균 (%)
export const avgTariffPct = (p: Policy, partner: string) => {
  const ts = p.tariffs[partner as BlocId]
  return ts.reduce((s, t) => s + tariffPct(t), 0) / ts.length
}

export interface PolicyChange {
  kind: 'tariff' | 'export_control' | 'investment'
  partner: BlocId | null // 투자율은 null
  good: string | null // 교역재 id. 투자율은 null
  from: number // 관세·투자율은 %, 수출 통제는 단계
  to: number
}

export function policyChanges(self: BlocId, before: Policy, after: Policy): PolicyChange[] {
  const out: PolicyChange[] = []
  for (const j of BLOCS) {
    if (j === self) continue
    TRADED.forEach((s, g) => {
      const a = tariffPct(before.tariffs[j][g])
      const b = tariffPct(after.tariffs[j][g])
      if (a !== b) out.push({ kind: 'tariff', partner: j, good: s.id, from: a, to: b })
    })
    TRADED.forEach((s, g) => {
      const a = before.exportControls[j][g]
      const b = after.exportControls[j][g]
      if (a !== b) out.push({ kind: 'export_control', partner: j, good: s.id, from: a, to: b })
    })
  }
  const a = ratePct(before.investmentRate)
  const b = ratePct(after.investmentRate)
  if (a !== b) out.push({ kind: 'investment', partner: null, good: null, from: a, to: b })
  return out
}

// 사람이 읽는 설명. 한 상대에게 같은 종류로 전 품목을 같은 값으로 바꾸면 한 줄로 묶는다
export function describeChanges(changes: PolicyChange[], name: (r: BlocId) => string, goodName: (id: string) => string): string[] {
  const lines: string[] = []
  const signed = (x: number) => `${x > 0 ? '+' : ''}${Number(x.toFixed(1))}`
  for (const kind of ['tariff', 'export_control'] as const) {
    for (const j of BLOCS) {
      const cs = changes.filter((c) => c.kind === kind && c.partner === j)
      if (cs.length === 0) continue
      const unit = kind === 'tariff' ? '%' : '단계'
      const label = kind === 'tariff' ? `${name(j)}산 수입품 관세` : `${name(j)}에 대한 수출 통제`
      const allSame = cs.length === TRADED.length && cs.every((c) => c.from === cs[0].from && c.to === cs[0].to)
      if (allSame) lines.push(`${label}: 전 품목 ${cs[0].from}${unit} → ${cs[0].to}${unit}`)
      else
        lines.push(
          `${label}: ${cs.map((c) => `${goodName(c.good!)} ${c.from}${unit} → ${c.to}${unit}${kind === 'tariff' ? ` (${signed(c.to - c.from)}%p)` : ''}`).join(', ')}`,
        )
    }
  }
  const inv = changes.find((c) => c.kind === 'investment')
  if (inv) lines.push(`투자율: ${inv.from}% → ${inv.to}%`)
  return lines
}
