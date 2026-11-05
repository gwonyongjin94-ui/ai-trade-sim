// v2 행동 기록부 (무료): 한 판에서 6개국 지도자가 분기마다 무엇을 생각하고, 누구에게 무엇을 말하고, 무엇을 했는지 읽을 수 있게 정리한다.
//   npm run transcript:v2 -- <실험 이름>            그 실험의 모든 런
//   npm run transcript:v2 -- <실험 이름> <런 id>    한 런만
// 결과: reports/<실험 이름>/transcripts/<런 id>.md
//
// 맨 위: 나라별 행동 요약 (src/v2/measure/: 전략 유형, 준·받은 확전점수, 보복·조준·편승, 말과 행동, 자기 인식, 결과 인식)
// 분기마다: 외교 1라운드(성명·비공개 메시지·제안·비공개 판단) → 결정(수락·메시지·정책 변화·이유·메모·자기 인식) → 결과(누가 누구에게 확전점수, 약속, 지표)
// 비공개 메시지와 비공개 판단은 연구 기록이라 모두 보인다 (게임 안에서는 받는 나라만 본다).

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { CULTURE_BRIEF_LABEL } from '../src/v2/culture'
import { describeBreaches, describeCommitment, describeTerm, TONE_LABEL } from '../src/v2/diplomacy'
import type { Tone } from '../src/v2/diplomacy'
import { AWARENESS_LABEL, codeMotives, hostileChange, KIND_LABEL, MOTIVES, OUTCOME_LABEL, outcomeReading, privateTexts, selfAwareness, summarizeAwareness, summarizeOutcome } from '../src/v2/measure/awareness'
import type { CheckedChange, Claim } from '../src/v2/measure/awareness'
import { actorDynamics, STRATEGY_LABEL, wordsAndDeeds } from '../src/v2/measure/dynamics'
import { actorTotal, escalationRecord, targetTotal } from '../src/v2/measure/escalation'
import { OBJECTIVE_LABEL } from '../src/v2/objectives'
import { avgTariffPct, describeChanges } from '../src/v2/policy'
import { BLOCS, regionName } from '../src/v2/regions'
import type { BlocId } from '../src/v2/regions'
import { TRADED } from '../src/v2/sectors'
import { RECAP_LABEL } from '../src/v2/sim/types'
import type { GameEvent } from '../src/v2/sim/types'

const ROOT = resolve(import.meta.dirname, '..')
const [name, only] = process.argv.slice(2)
if (!name) {
  console.log('사용법: npm run transcript:v2 -- <실험 이름> [런 id]')
  process.exit(1)
}
const dir = resolve(ROOT, 'runs', name)
if (!existsSync(dir)) throw new Error(`${dir} 없음`)
const outDir = resolve(ROOT, 'reports', name, 'transcripts')
mkdirSync(outDir, { recursive: true })

type Ev<T extends GameEvent['type']> = Extract<GameEvent, { type: T }>
const pct = (x: number) => (Number.isFinite(x) ? `${Math.round(x * 100)}%` : '-')
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '-')
const quote = (s: string) => s.trim().replace(/\n+/g, ' ')
const goodName = (id: string) => TRADED.find((s) => s.id === id)?.name ?? id
const nm = (b: BlocId) => `${b} ${regionName(b, 'real')}`
const others = (i: BlocId) => BLOCS.filter((b) => b !== i)
const tone = (t: string) => TONE_LABEL[t as Tone] ?? t

function transcript(id: string, events: GameEvent[]): string {
  const start = events.find((e): e is Ev<'start'> => e.type === 'start')!
  const quarters = events.filter((e): e is Ev<'quarter'> => e.type === 'quarter')
  const at = <T extends GameEvent['type']>(t: T, q: number, c?: BlocId) =>
    events.filter((e) => e.type === t && 'quarter' in e && e.quarter === q && (!c || ('country' in e && e.country === c))) as Ev<T>[]
  const es = escalationRecord(events)
  const per = <T>(f: (b: BlocId) => T) => Object.fromEntries(BLOCS.map((b) => [b, f(b)])) as Record<BlocId, T>
  const aware = per((c) => selfAwareness(events, c))
  const outcome = per((c) => outcomeReading(events, c))
  const level = (ch: { kind: string }, x: number) => (ch.kind === 'export_control' ? `${x}단계` : `${x}%`)
  const changeText = (ch: CheckedChange) => `${ch.partner ? `${nm(ch.partner)}${ch.kind === 'tariff' ? '산' : '에'} ` : ''}${ch.good ? goodName(ch.good) + ' ' : ''}${KIND_LABEL[ch.kind]} ${level(ch, ch.from)}→${level(ch, ch.to)}`
  const claimText = (cl: Claim) =>
    `${cl.partners.length ? cl.partners.join('·') + ' ' : ''}${cl.goods.length ? (cl.goods.length === TRADED.length ? '전 품목' : cl.goods.map(goodName).join('·')) + ' ' : ''}${KIND_LABEL[cl.kind]} ${cl.dir === 'up' ? '올림' : '내림'}`

  const md: string[] = [`# v2 행동 기록부: ${id}`, '']
  md.push(`- 지도자: ${BLOCS.map((c) => `${nm(c)} = ${start.leaders[c]} (${OBJECTIVE_LABEL[start.config.objectives[c]]})`).join(' · ')}`)
  md.push(
    `- 나라 이름: ${start.config.naming === 'real' ? '실제' : 'A~F'} · ${CULTURE_BRIEF_LABEL[start.config.culture]} · ${RECAP_LABEL[start.config.recap]} · ${quarters.length}분기 진행`,
  )
  md.push('')

  md.push('## 행동 요약', '')
  md.push(`| | ${BLOCS.map(nm).join(' | ')} |`, `|---|${BLOCS.map(() => '---').join('|')}|`)
  const row = (label: string, v: (c: BlocId) => string) => md.push(`| ${label} | ${BLOCS.map(v).join(' | ')} |`)
  const dyn = per((c) => actorDynamics(events, es, c))
  const words = per((c) => wordsAndDeeds(events, es, c))
  row('전략 유형', (c) => STRATEGY_LABEL[dyn[c].strategy].split(' (')[0])
  row('첫 확전 분기', (c) => (dyn[c].firstEscalation === null ? '없음' : `${dyn[c].firstEscalation! + 1}분기`))
  row('확전 (상대·분기) / 이유 없이', (c) => `${dyn[c].escalations} / ${dyn[c].unprovoked}`)
  row('준 / 받은 확전점수', (c) => `${actorTotal(es, c).reduce((s, x) => s + x, 0)} / ${targetTotal(es, c).reduce((s, x) => s + x, 0)}`)
  row('가장 많이 준 상대', (c) => {
    const top = others(c).map((j) => [j, es.score[c][j].reduce((s, x) => s + x, 0)] as const).sort((a, b) => b[1] - a[1])[0]
    return top && top[1] > 0 ? `${nm(top[0])} ${top[1]}` : '-'
  })
  row('보복률 / 조준 / 편승', (c) => `${pct(dyn[c].retaliationRate)} / ${pct(dyn[c].retaliationTargeting)} / ${pct(dyn[c].bandwagonRate)}`)
  row('비교 대상 겨냥', (c) => pct(dyn[c].comparatorShare))
  row('위협 실행 / 협력 말하며 확전', (c) => `${words[c].threatsCarriedOut}/${words[c].threats} / ${words[c].twoFaced}`)
  const last = quarters[quarters.length - 1]
  if (last) {
    row('평균 관세 끝 (%)', (c) => f1(BLOCS.filter((j) => j !== c).reduce((s, j) => s + avgTariffPct(last.policies[c], j), 0) / 5))
    row('생활수준 / 명목 GDP 비율 끝', (c) => `${f1(last.indicators[c].livingStandard)} / ${f1(last.ratio[c])}%`)
  }
  row('비공개 판단의 동기 (분기 수)', (c) => {
    const counts = new Map<string, number>()
    for (const t of privateTexts(events, c).values()) for (const k of codeMotives(t)) counts.set(k, (counts.get(k) ?? 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `${MOTIVES[k].label} ${n}`).join(', ') || '-'
  })
  row('자기 인식: 알고 / 반대 / 언급 없음 / 말만', (c) => {
    const s = summarizeAwareness(aware[c])
    return `${s.aware} / ${s.contradicted} / ${s.unmentioned} / ${s.saidNotDone}`
  })
  row('결과 인식: 하락 분기 중 알아챔', (c) => {
    const s = summarizeOutcome(outcome[c])
    return s.dropQuarters ? `${s.noticed}/${s.dropQuarters} (좋게 씀 ${s.misread})` : '하락 없음'
  })
  for (const t of events.filter((e): e is Ev<'term'> => e.type === 'term' && e.country === 'A'))
    row(`${t.leader}대 임기 점수 (${t.fromQuarter + 1}~${t.toQuarter + 1}분기)`, (c) => f1(events.find((e): e is Ev<'term'> => e.type === 'term' && e.country === c && e.leader === t.leader)?.score ?? NaN))
  md.push('', '확전 = 한 분기에 한 상대에게 준 확전점수 12 이상 (사후 계산, 지도자는 못 봄). 동기·자기 인식·결과 인식은 단어 일치로 센 대략값이니 근거 문장을 같이 본다.', '')

  for (const qe of quarters) {
    const q = qe.quarter
    md.push(`## ${Math.floor(q / 4) + 1}년차 ${(q % 4) + 1}분기 (${q + 1}분기)`, '')

    md.push('### 외교 1라운드', '')
    for (const c of BLOCS)
      for (const d of at('diplomacy', q, c)) {
        const st = d.action.statement
        const msgs = (d.action.messages ?? []).filter((m) => m.text?.trim())
        if (!st?.text?.trim() && !msgs.length && !d.proposals.length && !d.action.thinking) continue
        md.push(`- **${nm(c)}**${st?.text?.trim() ? ` 공개 성명 [${tone(st.tone)}]: "${quote(st.text)}"` : ''}`)
        for (const m of msgs) md.push(`  - → ${nm(m.to)} 비공개 [${tone(m.tone)}]: "${quote(m.text)}"`)
        for (const p of d.proposals) md.push(`  - 제안 ${p.id} → ${p.to.join('·')}: ${p.terms.map((t) => describeTerm(t, c, nm, goodName)).join('; ')} (${p.durationQuarters}분기)${p.note ? ` — ${quote(p.note)}` : ''}`)
        if (d.action.thinking) md.push(`  - 비공개 판단: ${quote(d.action.thinking)}`)
      }

    md.push('', '### 결정', '')
    for (const c of BLOCS)
      for (const d of at('decision', q, c)) {
        const st = d.action.statement
        md.push(`- **${nm(c)}**${st?.text?.trim() ? ` 공개 성명 [${tone(st.tone)}]: "${quote(st.text)}"` : ''}${d.accepted.length ? ` · 수락: ${d.accepted.join(', ')}` : ''}`)
        for (const m of (d.action.messages ?? []).filter((x) => x.text?.trim())) md.push(`  - → ${nm(m.to)} 비공개 [${tone(m.tone)}]: "${quote(m.text)}"`)
        const ch = describeChanges(d.changes, nm, goodName)
        md.push(`  - 정책: ${ch.length ? ch.join('; ') : '변화 없음'}${d.clamped.length ? ` (보정: ${d.clamped.join(', ')})` : ''}`)
        if (d.action.reasoning) md.push(`  - 이유: ${quote(d.action.reasoning)}`)
        if (d.action.memoToSelf) md.push(`  - 자기 메모: ${quote(d.action.memoToSelf)}`)
        const qa = aware[c].find((x) => x.quarter === q)
        if (qa && (qa.changes.length || qa.saidNotDone.length)) {
          const parts = (['aware', 'contradicted', 'unmentioned'] as const)
            .map((s) => {
              const xs = qa.changes.filter((x) => x.status === s)
              if (!xs.length) return ''
              const shown = xs.slice(0, 6).map((x) => changeText(x) + (hostileChange(x) ? ' (적대적)' : '')).join(', ')
              return `${s === 'aware' ? AWARENESS_LABEL[s] : `**${AWARENESS_LABEL[s]}**`} ${xs.length}건: ${shown}${xs.length > 6 ? ' 등' : ''}`
            })
            .filter(Boolean)
          if (qa.saidNotDone.length) parts.push(`**말만 함**: ${qa.saidNotDone.map(claimText).join(', ')}`)
          md.push(`  - 자기 인식: ${parts.join(' · ')}`)
          const evidence = [...new Set([...qa.changes.filter((x) => x.status === 'contradicted').map((x) => x.evidence!), ...qa.saidNotDone.map((cl) => cl.text)])]
          for (const t of evidence.slice(0, 4)) md.push(`    - 근거: "${quote(t)}"`)
        }
        const oq = outcome[c].find((x) => x.quarter === q)
        if (oq) {
          const what = oq.metric === 'absolute' ? '생활수준' : '명목 GDP 비율'
          md.push(`  - 결과 인식 (본 ${what} ${f1(oq.before)}→${f1(oq.seen)}): ${oq.status === 'misread' ? `**${OUTCOME_LABEL.misread}**` : OUTCOME_LABEL[oq.status]}`)
          if (oq.evidence) md.push(`    - 근거: "${quote(oq.evidence)}"`)
        }
      }

    md.push('', '### 결과', '')
    for (const i of BLOCS)
      for (const j of others(i)) {
        const items = es.items[i][j][q] ?? []
        if (!items.length) continue
        const score = es.score[i][j][q]
        const shown = items.slice(0, 5).map((x) => `${x.description} ${x.weight >= 0 ? '+' : ''}${x.weight}`).join(', ')
        md.push(`- 확전점수 ${nm(i)} → ${nm(j)}: ${score >= 0 ? '+' : ''}${score} (${shown}${items.length > 5 ? ` 외 ${items.length - 5}건` : ''})`)
      }
    if (es.publicThreats && BLOCS.some((b) => es.publicThreats[b][q])) md.push(`- 공개 위협 성명: ${BLOCS.filter((b) => es.publicThreats[b][q]).map(nm).join(', ')}`)
    for (const cm of qe.newCommitments) md.push(`- 새 약속 ${cm.id}: ${describeCommitment(cm, nm, goodName)} (${cm.startQuarter + 1}~${cm.endQuarter + 1}분기)`)
    for (const v of qe.violations) md.push(`- ${v.first ? '**약속 첫 위반**' : '약속 위반 계속'} ${v.commitmentId} (${nm(v.obligor)}): ${describeBreaches(v.breaches, nm, goodName)}`)
    for (const a of at('anomaly', q)) md.push(`- 이상 기록 [${a.kind}]${a.country ? ` ${nm(a.country)}` : ''}: ${a.detail}`)
    md.push(
      '',
      `| | ${BLOCS.map(nm).join(' | ')} |`,
      `|---|${BLOCS.map(() => '---').join('|')}|`,
      `| 생활수준 | ${BLOCS.map((b) => f1(qe.indicators[b].livingStandard)).join(' | ')} |`,
      `| 명목 GDP 비율 (%) | ${BLOCS.map((b) => f1(qe.ratio[b])).join(' | ')} |`,
      `| 평균 관세 (%) | ${BLOCS.map((b) => f1(others(b).reduce((s, j) => s + avgTariffPct(qe.policies[b], j), 0) / 5)).join(' | ')} |`,
      `| 자본 | ${BLOCS.map((b) => f1(qe.indicators[b].capital)).join(' | ')} |`,
      '',
    )

    for (const t of events.filter((e): e is Ev<'term'> => e.type === 'term' && e.toQuarter === q))
      md.push(`> **${nm(t.country)} ${t.leader}대 지도자 임기 끝** (점수 ${f1(t.score)}). 인수인계 메모: ${t.handoverMemo ? quote(t.handoverMemo) : '(없음)'}`, '')
  }
  return md.join('\n') + '\n'
}

let n = 0
for (const file of readdirSync(dir).filter((x) => x.endsWith('.jsonl')).sort()) {
  const parsed = readFileSync(resolve(dir, file), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as GameEvent | { type: 'run'; version?: number; spec: { id: string } })
  const head = parsed.find((e) => e.type === 'run') as { version?: number; spec: { id: string } } | undefined
  if (!head || head.version !== 2 || (only && head.spec.id !== only)) continue
  const events = parsed.filter((e) => e.type !== 'run') as GameEvent[]
  if (!events.some((e) => e.type === 'start')) continue
  writeFileSync(resolve(outDir, `${head.spec.id}.md`), transcript(head.spec.id, events))
  n++
}
console.log(`${outDir} 에 기록부 ${n}개`)
