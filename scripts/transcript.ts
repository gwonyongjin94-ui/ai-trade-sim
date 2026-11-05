// 행동 기록부 (무료): 한 게임에서 두 대통령이 분기마다 무엇을 생각하고, 말하고, 했는지 읽을 수 있게 정리한다.
//   npm run transcript -- <실험 이름>            그 실험의 모든 런
//   npm run transcript -- <실험 이름> <런 id>    한 런만
// 결과: reports/<실험 이름>/transcripts/<런 id>.md
//
// 분기마다: 외교 1라운드(메시지·제안·비공개 판단) → 결정(수락·메시지·정책 변화·이유·메모) → 결과(확전점수·약속·지표).
// 맨 위에는 behavior.ts로 계산한 행동 요약(누가 먼저 확전했나, 보복·호응·완화 비율, 전략 유형)이 붙는다.
// 결정마다 자기 인식 검사 결과(실제 정책 변화를 비공개 텍스트에서 알고 있었나)와 근거 문장을 붙인다.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CULTURE_BRIEF_LABEL } from '../src/engine/culture'
import type { CultureBrief } from '../src/engine/culture'
import { describeBreaches, describeTerm, TONE_LABEL } from '../src/engine/diplomacy'
import { GOODS, goodName } from '../src/engine/goods'
import type { GoodId, Naming } from '../src/engine/goods'
import { OBJECTIVE_LABEL } from '../src/engine/objectives'
import { COUNTRIES, EXPORT_LEVEL_LABEL } from '../src/engine/types'
import type { CountryId, Policy } from '../src/engine/types'
import { statusQuoPolicy } from '../src/engine/world'
import { AWARENESS_LABEL, codeMotives, dynamicsOf, hostileChange, KIND_LABEL, MOTIVES, OUTCOME_LABEL, outcomeReading, privateTexts, selfAwareness, STRATEGY_LABEL, summarizeAwareness, summarizeOutcome } from '../src/sim/behavior'
import type { Claim, PolicyChange } from '../src/sim/behavior'
import { ES_VIEW_LABEL, RECAP_LABEL } from '../src/sim/types'
import type { GameEvent } from '../src/sim/types'

const ROOT = resolve(import.meta.dirname, '..')
const [name, only] = process.argv.slice(2)
if (!name) {
  console.log('사용법: npm run transcript -- <실험 이름> [런 id]')
  process.exit(1)
}
const dir = resolve(ROOT, 'runs', name)
if (!existsSync(dir)) throw new Error(`${dir} 없음`)
const outDir = resolve(ROOT, 'reports', name, 'transcripts')
mkdirSync(outDir, { recursive: true })

type Ev<T extends GameEvent['type']> = Extract<GameEvent, { type: T }>
const pct = (x: number) => `${Math.round(x * 100)}%`
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '-')
const rate = (x: number) => (Number.isFinite(x) ? pct(x) : '-')
const quote = (s: string) => s.trim().replace(/\n+/g, ' ')

function policyChanges(prev: Policy, next: Policy, name: (g: GoodId) => string): string[] {
  const out: string[] = []
  GOODS.forEach((g, i) => {
    if (Math.abs(prev.tariffs[i] - next.tariffs[i]) > 1e-9) out.push(`${name(g.id)} 관세 ${pct(prev.tariffs[i])}→${pct(next.tariffs[i])}`)
    if (prev.exportControls[i] !== next.exportControls[i])
      out.push(`${name(g.id)} 수출 통제 ${EXPORT_LEVEL_LABEL[prev.exportControls[i]]}→${EXPORT_LEVEL_LABEL[next.exportControls[i]]}`)
  })
  if (Math.abs(prev.investmentRate - next.investmentRate) > 1e-9) out.push(`투자율 ${pct(prev.investmentRate)}→${pct(next.investmentRate)}`)
  return out
}

function transcript(id: string, events: GameEvent[]): string {
  const start = events.find((e): e is Ev<'start'> => e.type === 'start')!
  const naming: Naming = start.config.naming
  const culture: CultureBrief = start.config.culture ?? 'shown'
  const name = (g: GoodId) => goodName(GOODS.find((x) => x.id === g)!, naming)
  const quarters = events.filter((e): e is Ev<'quarter'> => e.type === 'quarter')
  const at = <T extends GameEvent['type']>(t: T, q: number, c?: CountryId) =>
    events.filter((e) => e.type === t && 'quarter' in e && e.quarter === q && (!c || ('country' in e && e.country === c))) as Ev<T>[]
  const who = (c: CountryId) => `${c}국 (${start.leaders[c]})`
  const aware = { A: selfAwareness(events, 'A'), B: selfAwareness(events, 'B') }
  const outcome = { A: outcomeReading(events, 'A'), B: outcomeReading(events, 'B') }
  const level = (kind: PolicyChange['kind'], x: number) => (kind === 'control' ? `${x}단계` : `${Number((x * 100).toFixed(1))}%`)
  const changeText = (ch: PolicyChange) => `${ch.good ? name(ch.good) + ' ' : ''}${KIND_LABEL[ch.kind]} ${level(ch.kind, ch.from)}→${level(ch.kind, ch.to)}`
  const claimText = (cl: Claim) => `${cl.goods.length ? cl.goods.map(name).join('·') + ' ' : ''}${KIND_LABEL[cl.kind]} ${cl.dir === 'up' ? '올림' : '내림'}`

  const md: string[] = [`# 행동 기록부: ${id}`, '']
  md.push(`- 대통령: ${COUNTRIES.map((c) => `${who(c)}, ${OBJECTIVE_LABEL[start.config.objectives[c]]}`).join(' · ')}`)
  md.push(`- 물품 이름: ${naming === 'real' ? '실제' : '익명'} · ${CULTURE_BRIEF_LABEL[culture]} · ${RECAP_LABEL[start.config.recap ?? 'off']} · ${ES_VIEW_LABEL[start.config.esView ?? 'shown']} · ${quarters.length}분기 진행`)
  md.push('')

  md.push('## 행동 요약', '')
  md.push('| | ' + COUNTRIES.map(who).join(' | ') + ' |', '|---|---|---|')
  const dyn = { A: dynamicsOf(events, 'A'), B: dynamicsOf(events, 'B') }
  const row = (label: string, v: (c: CountryId) => string) => md.push(`| ${label} | ${v('A')} | ${v('B')} |`)
  row('전략 유형', (c) => STRATEGY_LABEL[dyn[c].strategy])
  row('첫 확전 분기', (c) => (dyn[c].firstEscalation === null ? '없음' : `${dyn[c].firstEscalation! + 1}분기`))
  row('확전 횟수 (그중 상대 확전 없이)', (c) => `${dyn[c].escalations} (${dyn[c].unprovoked})`)
  row('보복률: 상대 확전 다음 분기에 올림', (c) => rate(dyn[c].retaliationRate))
  row('호응률: 상대 완화 다음 분기에 완화', (c) => rate(dyn[c].reciprocityRate))
  row('보복 뒤 4분기 안에 완화', (c) => rate(dyn[c].forgivenessRate))
  const last = quarters[quarters.length - 1]
  if (last) {
    row('평균 관세 (마지막 분기)', (c) => pct(last.indicators[c].avgTariff))
    row('누적 확전점수', (c) => String(last.es[c].cumulative))
    row('생활수준 / 자본 (마지막 분기)', (c) => `${f1(last.indicators[c].livingStandard)} / ${f1(last.indicators[c].capital)}`)
  }
  const texts = { A: privateTexts(events, 'A'), B: privateTexts(events, 'B') }
  row('비공개 판단에 나온 동기 (분기 수)', (c) => {
    const counts = new Map<string, number>()
    for (const t of texts[c].values()) for (const k of codeMotives(t)) counts.set(k, (counts.get(k) ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${MOTIVES[k].label} ${n}`).join(', ') || '-'
  })
  const aw = { A: summarizeAwareness(aware.A), B: summarizeAwareness(aware.B) }
  row('자기 인식: 바꾼 정책 (건)', (c) => `${aw[c].changes}건: ${AWARENESS_LABEL.aware} ${aw[c].aware} · ${AWARENESS_LABEL.contradicted} ${aw[c].contradicted} · ${AWARENESS_LABEL.unmentioned} ${aw[c].unmentioned}`)
  row('적대적 변화(관세 인상·통제 강화) 중 알고 함', (c) => `${aw[c].hostileAware}/${aw[c].hostile}`)
  row('말만 함 (바꿨다고 썼지만 그 정책은 그대로)', (c) => String(aw[c].saidNotDone))
  const oc = { A: summarizeOutcome(outcome.A), B: summarizeOutcome(outcome.B) }
  row('결과 인식: 생활수준 하락 분기', (c) => `${oc[c].dropQuarters}분기: ${OUTCOME_LABEL.noticed} ${oc[c].noticed} · ${OUTCOME_LABEL.misread} ${oc[c].misread} · ${OUTCOME_LABEL.silent} ${oc[c].silent}`)
  const terms = events.filter((e): e is Ev<'term'> => e.type === 'term')
  for (const p of [...new Set(terms.map((t) => t.president))]) {
    const of = (c: CountryId) => terms.find((t) => t.president === p && t.country === c)
    row(`${p}대 임기 점수 (${of('A')!.fromQuarter + 1}~${of('A')!.toQuarter + 1}분기)`, (c) => f1(of(c)?.score ?? NaN))
  }
  md.push('', '전략 유형과 비율은 확전점수(Rivera) +12 이상을 확전으로 본 계산값이다. 동기, 자기 인식, 결과 인식은 비공개 텍스트의 단어 일치로 센 대략값이니 근거 문장을 같이 본다.', '')

  let prevPolicy: Record<CountryId, Policy> = { A: statusQuoPolicy(), B: statusQuoPolicy() }
  for (const qe of quarters) {
    const q = qe.quarter
    md.push(`## ${Math.floor(q / 4) + 1}년차 ${(q % 4) + 1}분기 (${q + 1}분기)`, '')

    md.push('### 외교 1라운드', '')
    for (const c of COUNTRIES) {
      for (const d of at('diplomacy', q, c)) {
        md.push(`- **${c}국** [${TONE_LABEL[d.action.tone]}] ${d.action.message ? `"${quote(d.action.message)}"` : '(메시지 없음)'}`)
        for (const p of d.proposals) md.push(`  - 제안 ${p.id}: ${p.terms.map((t) => describeTerm(t, c, name)).join('; ')} (${p.durationQuarters}분기)${p.note ? ` — ${quote(p.note)}` : ''}`)
        if (d.action.thinking) md.push(`  - 속마음: ${quote(d.action.thinking)}`)
      }
    }
    md.push('', '### 결정', '')
    for (const c of COUNTRIES) {
      for (const d of at('decision', q, c)) {
        md.push(`- **${c}국** [${TONE_LABEL[d.action.tone]}] ${d.action.message ? `"${quote(d.action.message)}"` : '(메시지 없음)'}${d.accepted.length ? ` · 수락: ${d.accepted.join(', ')}` : ''}`)
        const ch = policyChanges(prevPolicy[c], d.applied, name)
        md.push(`  - 정책: ${ch.length ? ch.join(', ') : '변화 없음'}${d.clamped.length ? ` (범위 보정: ${d.clamped.join(', ')})` : ''}`)
        if (d.action.reasoning) md.push(`  - 이유: ${quote(d.action.reasoning)}`)
        if (d.action.memoToSelf) md.push(`  - 자기 메모: ${quote(d.action.memoToSelf)}`)
        const qa = aware[c].find((x) => x.quarter === q)
        if (qa && (qa.changes.length || qa.saidNotDone.length)) {
          const parts = (['aware', 'contradicted', 'unmentioned'] as const)
            .map((st) => {
              const xs = qa.changes.filter((ch) => ch.status === st)
              return xs.length ? `${st === 'aware' ? AWARENESS_LABEL[st] : `**${AWARENESS_LABEL[st]}**`}: ${xs.map((ch) => changeText(ch) + (hostileChange(ch) ? ' (적대적)' : '')).join(', ')}` : ''
            })
            .filter(Boolean)
          if (qa.saidNotDone.length) parts.push(`**말만 함**: ${qa.saidNotDone.map(claimText).join(', ')}`)
          md.push(`  - 자기 인식: ${parts.join(' · ')}`)
          const evidence = [...new Set([...qa.changes.filter((ch) => ch.status === 'contradicted').map((ch) => ch.evidence!), ...qa.saidNotDone.map((cl) => cl.text)])]
          for (const t of evidence) md.push(`    - 근거: "${quote(t)}"`)
        }
        const oq = outcome[c].find((x) => x.quarter === q)
        if (oq) {
          md.push(`  - 결과 인식 (본 생활수준 ${oq.before.toFixed(1)}→${oq.seen.toFixed(1)}): ${oq.status === 'misread' ? `**${OUTCOME_LABEL.misread}**` : OUTCOME_LABEL[oq.status]}`)
          if (oq.evidence) md.push(`    - 근거: "${quote(oq.evidence)}"`)
        }
      }
    }
    md.push('', '### 결과', '')
    for (const c of COUNTRIES) {
      const es = qe.es[c]
      const acts = es.actions.map((a) => `${a.description} ${a.weight >= 0 ? '+' : ''}${a.weight}`).join(', ')
      const ind = qe.indicators[c]
      md.push(
        `- ${c}국: 확전점수 ${es.score >= 0 ? '+' : ''}${es.score}${acts ? ` (${acts})` : ''}${es.sudden ? ' **급격한 확전**' : ''} · 생활수준 ${f1(ind.livingStandard)} · 자본 ${f1(ind.capital)} · 물가 ${Number.isFinite(ind.inflation) ? `${ind.inflation > 0 ? '+' : ''}${(ind.inflation * 100).toFixed(1)}%` : '-'} · 평균 관세 ${pct(ind.avgTariff)}${ind.shortage > 0 ? ` · 필수재 부족 ${ind.shortage.toFixed(3)}` : ''}`,
      )
    }
    for (const cm of qe.newCommitments) md.push(`- 새 약속 ${cm.id}: ${cm.obligor}국 ${cm.goods.length === GOODS.length ? '전 품목' : cm.goods.map(name).join('·')} ${cm.kind === 'tariff_max' ? `관세 ${cm.value}% 이하` : `수출 통제 ${cm.value}단계 이하`} (${cm.startQuarter + 1}~${cm.endQuarter + 1}분기)`)
    for (const v of qe.violations) md.push(`- ${v.first ? '**약속 첫 위반**' : '약속 위반 계속'} ${v.commitmentId} (${v.obligor}국): ${describeBreaches(v.breaches, name)}`)
    for (const a of at('anomaly', q)) md.push(`- 이상 사건 [${a.kind}]${a.country ? ` ${a.country}국` : ''}: ${a.detail}`)
    md.push('')

    for (const t of events.filter((e): e is Ev<'term'> => e.type === 'term' && e.toQuarter === q))
      md.push(`> **${t.country}국 ${t.president}대 대통령 임기 끝** (점수 ${f1(t.score)}). 인수인계 메모: ${t.handoverMemo ? quote(t.handoverMemo) : '(없음)'}`, '')
    prevPolicy = qe.policies
  }
  return md.join('\n') + '\n'
}

let n = 0
for (const file of readdirSync(dir).filter((x) => x.endsWith('.jsonl')).sort()) {
  const lines = readFileSync(resolve(dir, file), 'utf8').split('\n').filter(Boolean)
  const parsed = lines.map((l) => JSON.parse(l) as GameEvent | { type: 'run'; spec: { id: string } })
  const head = parsed.find((e) => e.type === 'run') as { spec: { id: string } } | undefined
  if (!head || (only && head.spec.id !== only)) continue
  const events = parsed.filter((e) => e.type !== 'run') as GameEvent[]
  if (!events.some((e) => e.type === 'start')) continue
  writeFileSync(resolve(outDir, `${head.spec.id}.md`), transcript(head.spec.id, events))
  n++
}
console.log(`${outDir} 에 기록부 ${n}개`)
