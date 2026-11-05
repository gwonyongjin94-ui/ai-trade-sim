// 가짜 LLM 응답 (무료). v2 실험 실행기 --mock과 측정 테스트에서, 돈을 쓰지 않고 기록·측정·보고서 전체를 돌려 보려고 쓴다.
// 행동은 시드로 정해지는 난수다: 가끔 관세를 올리거나 내리고, 위협·협력 메시지와 제안을 보내고, 받은 제안의 절반쯤을 수락한다.
// 결정 이유에는 실제로 바꾼 것을 적되 가끔 반대로 적어서, 자기 인식 검사의 "반대로 앎"도 나오게 한다. 연구 결과로 쓰면 안 된다.

import type { LlmResponse, LlmTransport } from '../../sim/llmTypes'
import { BLOCS, regionName } from '../regions'
import type { BlocId } from '../regions'
import { TRADED } from '../sectors'

// mulberry32
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const hash = (s: string) => [...s].reduce((h, ch) => (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0, 2166136261)

const ok = (json: unknown): LlmResponse => ({
  ok: true,
  json,
  text: '',
  model: 'mock',
  requestedModel: 'mock',
  stopReason: 'end_turn',
  usage: {},
  fallback: false,
  latencyMs: 0,
})

export function mockTransport(seed: string, country: BlocId): LlmTransport {
  const partners = BLOCS.filter((b) => b !== country)
  return async (req) => {
    const quarter = Number(/전체 \d+분기 중 (\d+)번째/.exec(req.user)?.[1] ?? 0)
    const props = req.schema.properties as Record<string, unknown>
    const round = 'proposals' in props ? 1 : 2
    const r = rng(hash(`${seed}:${country}:${quarter}:${round}`))
    const pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)]
    const name = (b: BlocId) => regionName(b, /너는 [A-F]국의 지도자/.test(req.system) ? 'abstract' : 'real')

    if (round === 1) {
      const messages = []
      if (r() < 0.25) messages.push({ to: pick(partners), text: '우리 물품 관세를 올리면 대응하겠다.', tone: 'threat' })
      if (r() < 0.3) messages.push({ to: pick(partners), text: '서로 관세를 낮추자.', tone: 'cooperative' })
      const proposals = []
      if (r() < 0.2) {
        const to = [...new Set([pick(partners), pick(partners)])]
        proposals.push({ to, terms: [{ obligor: 'all', kind: 'tariff_max', goods: [pick(TRADED).id], value: 5 }], duration_quarters: 4, note: '관세 상한' })
      }
      const tone = pick(['cooperative', 'neutral', 'neutral', 'warning'])
      return ok({ thinking: '이번 분기 상황을 본다.', statement: { text: r() < 0.5 ? '공정한 교역을 원한다.' : '', tone }, messages, proposals })
    }

    // 2라운드: 현재 정책 JSON을 받아 조금 바꾼다
    const line = req.user.split('\n').find((l) => l.startsWith('{"tariffs_pct"'))
    if (!line) return ok(null)
    const cur = JSON.parse(line) as { tariffs_pct: Record<string, Record<string, number>>; export_controls: Record<string, Record<string, number>>; investment_rate_pct: number }
    const notes: string[] = []
    const say = (truth: string, opposite: string) => notes.push(r() < 0.15 ? opposite : truth)
    if (r() < 0.15) {
      const j = pick(partners)
      const g = pick(TRADED)
      const d = 10 + Math.round(r() * 20)
      cur.tariffs_pct[j][g.id] = Math.min(200, cur.tariffs_pct[j][g.id] + d)
      say(`${name(j)}산 ${g.name} 관세를 ${d}%p 인상한다`, `${name(j)}산 ${g.name} 관세를 인하한다`)
    }
    if (r() < 0.15) {
      const j = pick(partners)
      for (const g of TRADED) cur.tariffs_pct[j][g.id] = Math.max(0, cur.tariffs_pct[j][g.id] - 2)
      say(`${name(j)}산 전 품목 관세를 2%p 인하한다`, `${name(j)}산 전 품목 관세를 인상한다`)
    }
    if (r() < 0.05) {
      const j = pick(partners)
      const g = pick(TRADED)
      cur.export_controls[j][g.id] = Math.min(3, cur.export_controls[j][g.id] + 1)
      say(`${name(j)}에 대한 ${g.name} 수출 통제를 강화한다`, `${name(j)}에 대한 ${g.name} 수출 통제를 완화한다`)
    }
    if (r() < 0.2) {
      const d = r() < 0.5 ? -1 : 1
      cur.investment_rate_pct = Math.round((cur.investment_rate_pct + d) * 10) / 10
      say(`투자율을 ${d > 0 ? '높인다' : '낮춘다'}`, `투자율을 ${d > 0 ? '낮춘다' : '높인다'}`)
    }
    const section = req.user.split('# 이번 분기 우리에게 온 제안')[1]?.split('\n#')[0] ?? ''
    const ids = [...section.matchAll(/\[([A-F]\d+-\d+)\]/g)].map((m) => m[1])
    const accept = ids.filter(() => r() < 0.5)
    if (accept.length) notes.push(`제안 ${accept.join(', ')} 수락`)
    const messages = r() < 0.15 ? [{ to: pick(partners), text: '협력하자.', tone: 'cooperative' }] : []
    return ok({
      reasoning: notes.length ? notes.join('. ') + '.' : '현재 정책을 유지한다.',
      accept_proposals: accept,
      statement: { text: '', tone: 'neutral' },
      messages,
      ...cur,
      memo_to_self: '',
      handover_memo: /마지막 분기/.test(req.user) ? '정책을 크게 바꾸지 않았다.' : '',
    })
  }
}
