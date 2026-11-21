// 실험 기록(runs/*/*.jsonl)을 웹 지도의 AI 리플레이 파일로 바꾼다 (무료, 기록만 읽는다).
//   npm run replay:export
// 결과: public/replays/index.json + public/replays/<id>.json
// 사이트에는 API 키가 없다. AI 대전은 로컬에서 돌린 기록만 다시 재생한다.
// 아직 실제 AI(LLM) 지도자 기록이 없어서 규칙 지도자 기록과 모의 응답 기록을 싣는다. 종류(kind)를 화면에 그대로 밝힌다.

import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describeBreaches, describeCommitment, describeTerm } from '../src/v2/diplomacy'
import { actorDynamics, STRATEGY_LABEL } from '../src/v2/measure/dynamics'
import { actorTotal, escalationRecord, targetTotal } from '../src/v2/measure/escalation'
import { OBJECTIVE_LABEL } from '../src/v2/objectives'
import { describeChanges } from '../src/v2/policy'
import { BLOCS, REGIONS, regionName } from '../src/v2/regions'
import type { BlocId } from '../src/v2/regions'
import { TRADED } from '../src/v2/sectors'
import type { GameEvent } from '../src/v2/sim/types'
import type { ReplayBloc, ReplayFile, ReplayIndexEntry, ReplayKind, ReplayQuarter, Tone } from '../src/web/replay/types'

const ROOT = resolve(import.meta.dirname, '..')
const OUT = resolve(ROOT, 'public/replays')

// 싣는 기록. 실제 AI 기록이 생기면 여기에 더한다 (kind: 'llm')
const PICK: { run: string; id: string; title: string; kind: ReplayKind; note: string }[] = [
  {
    run: 'v2-provoke/all-A-real-shown-tit-for-tat-E_provocateur-r01',
    id: 'rule-provoke-tft',
    title: '규칙: 미국 도발 + 팃포탯',
    kind: 'rule',
    note: '미국 자리는 3분기에 중국산 관세를 25%p 올리는 도발자 규칙, 나머지 다섯 나라는 상대가 올린 만큼 되돌려 주는 팃포탯 규칙이다. 중국만 미국에게 보복한다.',
  },
  {
    run: 'v2-provoke/all-A-real-shown-free-trade-E_provocateur-r01',
    id: 'rule-provoke-free',
    title: '규칙: 미국 도발 + 자유무역',
    kind: 'rule',
    note: '나머지 다섯 나라는 해마다 서로 무관세를 제안하고 모든 제안을 받는 자유무역 규칙이다. 미국은 약속에 들지 않고 중국에 관세를 올린다.',
  },
  {
    run: 'v2-rules/all-A-real-shown-free-trade-r01',
    id: 'rule-free',
    title: '규칙: 모두 자유무역',
    kind: 'rule',
    note: '여섯 나라 모두 자유무역 규칙. 1분기에 서로 무관세 약속을 맺고 해마다 갱신한다.',
  },
  {
    run: 'v2-provoke/all-A-real-shown-status-quo-E_provocateur-r01',
    id: 'rule-provoke-sq',
    title: '규칙: 미국 도발 + 현상 유지',
    kind: 'rule',
    note: '나머지 다섯 나라는 아무것도 바꾸지 않는 현상 유지 규칙이다. 미국의 관세 인상에 아무도 대응하지 않는다.',
  },
  {
    run: 'v2-mock/all-A-real-shown-mock-r01',
    id: 'mock-r01',
    title: '모의 응답 (화면 확인용)',
    kind: 'mock',
    note: '실제 AI가 아니라 무작위 가짜 응답으로 돌린 기록이다. 문장은 의미가 없고, 제안·약속·위반이 화면에 어떻게 보이는지 확인하는 용도다.',
  },
]

type Ev<T extends GameEvent['type']> = Extract<GameEvent, { type: T }>
const name = (r: BlocId) => regionName(r, 'real')
const goodName = (id: string) => TRADED.find((s) => s.id === id)?.name ?? id
const r2 = (x: number) => Math.round(x * 100) / 100
const r4 = (x: number) => Math.round(x * 1e4) / 1e4
const finite = (x: number) => (Number.isFinite(x) ? r4(x) : null)
const perBloc = <T>(f: (b: BlocId) => T) => Object.fromEntries(BLOCS.map((b) => [b, f(b)])) as Record<BlocId, T>
const TONES = new Set(['cooperative', 'neutral', 'warning', 'threat'])
const tone = (t: unknown): Tone => (TONES.has(String(t)) ? (t as Tone) : 'neutral')

function leaderLabel(s: string) {
  if (s === 'mock') return '모의 응답'
  const rule: Record<string, string> = {
    'rule:status-quo': '규칙 · 현상 유지',
    'rule:free-trade': '규칙 · 자유무역',
    'rule:tit-for-tat': '규칙 · 팃포탯',
    'rule:provocateur': '규칙 · 도발자',
  }
  return rule[s] ?? s
}

function convert(events: GameEvent[], pick: (typeof PICK)[number]): ReplayFile {
  const start = events.find((e): e is Ev<'start'> => e.type === 'start')!
  const run = events.find((e) => (e as { type: string }).type === 'run') as unknown as { code?: { commit?: string } } | undefined
  const quarters = events.filter((e): e is Ev<'quarter'> => e.type === 'quarter')
  const es = escalationRecord(events)
  const out: ReplayQuarter[] = []
  const commitments: Ev<'quarter'>['newCommitments'] = []

  for (const qe of quarters) {
    const q = qe.quarter
    const blocs = perBloc((): ReplayBloc => ({ statements: [], messages: [], proposals: [], accepted: [], changes: [], changeCount: 0, thinking: '', reasoning: '', clamped: [] }))
    for (const e of events) {
      if ((e.type !== 'diplomacy' && e.type !== 'decision') || e.quarter !== q) continue
      const b = blocs[e.country]
      const round = e.type === 'diplomacy' ? 1 : 2
      const st = e.action.statement
      if (st?.text?.trim()) b.statements.push({ round, text: st.text.trim(), tone: tone(st.tone) })
      for (const m of e.action.messages ?? [])
        if (m.text?.trim() && BLOCS.includes(m.to) && m.to !== e.country) b.messages.push({ round, to: m.to, text: m.text.trim(), tone: tone(m.tone) })
      if (e.type === 'diplomacy') {
        b.thinking = (e.action.thinking ?? '').trim()
        b.proposals = e.proposals.map((p) => ({ id: p.id, to: p.to, terms: p.terms.map((t) => describeTerm(t, p.from, name, goodName)), note: p.note ?? '', duration: p.durationQuarters }))
      } else {
        b.reasoning = (e.action.reasoning ?? '').trim()
        b.accepted = e.accepted
        b.changes = describeChanges(e.changes, name, goodName)
        b.changeCount = e.changes.length
        b.clamped = e.clamped
      }
    }
    commitments.push(...qe.newCommitments)
    const pairs = new Set<string>()
    for (const cm of commitments)
      if (cm.startQuarter <= q && q <= cm.endQuarter) for (const t of cm.toward) pairs.add([cm.obligor, t].sort().join(''))
    out.push({
      q,
      blocs,
      es: BLOCS.flatMap((i) =>
        BLOCS.filter((j) => j !== i && es.score[i][j][q] !== 0).map((j) => ({ from: i, to: j, score: es.score[i][j][q], items: es.items[i][j][q].map((x) => x.description) })),
      ),
      newCommitments: qe.newCommitments.map((cm) => ({ id: cm.id, obligor: cm.obligor, toward: cm.toward, text: describeCommitment(cm, name, goodName) })),
      violations: qe.violations.map((v) => ({ id: v.commitmentId, obligor: v.obligor, first: v.first, text: describeBreaches(v.breaches, name, goodName) })),
      active: [...pairs].sort().map((p) => [p[0], p[1]] as [BlocId, BlocId]),
      ind: Object.fromEntries(
        REGIONS.map((r) => {
          const x = qe.indicators[r]
          return [r, { livingStandard: r4(x.livingStandard), realGdp: r4(x.realGdp), nominalGdpUsd: Math.round(x.nominalGdpUsd), exports: r2(x.exportsValue), imports: r2(x.importsValue) }]
        }),
      ) as ReplayQuarter['ind'],
      ratio: perBloc((b) => r4(qe.ratio[b])),
      anomalies: events
        .filter((e): e is Ev<'anomaly'> => e.type === 'anomaly' && e.quarter === q)
        .map((e) => ({ country: e.country, kind: e.kind, detail: e.detail })),
    })
  }

  const terms = events.filter((e): e is Ev<'term'> => e.type === 'term')
  const actors = perBloc((b) => {
    const d = actorDynamics(events, es, b)
    const t = terms.filter((x) => x.country === b).at(-1)
    return {
      strategy: STRATEGY_LABEL[d.strategy],
      given: actorTotal(es, b).reduce((a, x) => a + x, 0),
      received: targetTotal(es, b).reduce((a, x) => a + x, 0),
      escalations: d.escalations,
      retaliationRate: finite(d.retaliationRate),
      firstEscalation: d.firstEscalation,
      objective: OBJECTIVE_LABEL[d.objective],
      score: t ? finite(t.score) : null,
      startScore: t ? finite(t.startScore) : null,
    }
  })

  return {
    id: pick.id,
    title: pick.title,
    kind: pick.kind,
    note: pick.note,
    leaders: perBloc((b) => leaderLabel(start.leaders[b])),
    config: {
      years: start.config.years,
      naming: start.config.naming,
      culture: start.config.culture,
      recap: start.config.recap,
      objectives: perBloc((b) => OBJECTIVE_LABEL[start.config.objectives[b]]),
    },
    source: { run: `runs/${pick.run}.jsonl`, commit: run?.code?.commit ?? null, startedAt: start.startedAt ?? null },
    quarters: out,
    totals: { es: perBloc((i) => perBloc((j) => (i === j ? 0 : es.score[i][j].reduce((a, x) => a + x, 0)))), actors },
  }
}

if (existsSync(OUT)) for (const f of readdirSync(OUT)) rmSync(resolve(OUT, f))
mkdirSync(OUT, { recursive: true })
const index: ReplayIndexEntry[] = []
for (const p of PICK) {
  const file = resolve(ROOT, 'runs', `${p.run}.jsonl`)
  const events = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as GameEvent)
  const r = convert(events, p)
  const json = JSON.stringify(r)
  writeFileSync(resolve(OUT, `${p.id}.json`), json)
  index.push({ id: p.id, title: p.title, kind: p.kind, note: p.note, quarters: r.quarters.length })
  console.log(`${p.id}: ${r.quarters.length}분기, ${(json.length / 1024).toFixed(0)}KB`)
}
writeFileSync(resolve(OUT, 'index.json'), JSON.stringify(index, null, 1))
console.log(`리플레이 ${index.length}개 → public/replays/`)
