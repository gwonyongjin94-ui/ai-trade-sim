// v2 규칙 이해도 검사: 지도자가 6개국 규칙·상황표·다자 약속을 제대로 읽는지, 지시한 정책을 상대국 × 물품 표에 제대로 쓰는지 본다.
//   npm run quiz:v2 -- --dry                                   질문·정답·과제만 출력 (모델 호출 없음)
//   npm run quiz:v2 -- --models claude-haiku-5-5 --repeats 3   계획과 비용만
//   npm run quiz:v2 -- --models claude-haiku-5-5 --repeats 3 --yes
// 지도자와 똑같은 시스템 프롬프트와 2라운드 관측(대한민국, 3분기)을 주고
//  - 확인 질문 14개 (정답은 관측에서 계산된다)
//  - 실행 과제 2개 (말로 지시한 정책 변경을 결정 JSON으로 쓰기)
// 를 묻는다 (v1 scripts/quiz.ts와 같은 방식). 유료 모델은 --yes가 있어야 호출한다 (반복마다 3회).
// 결과: reports/quiz-v2.md, reports/quiz-v2.json (모델별로 덮어씀)

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { largestOther } from '../src/v2/objectives'
import { tariffPct } from '../src/v2/policy'
import { BLOCS } from '../src/v2/regions'
import type { BlocId } from '../src/v2/regions'
import { sectorIndex, TRADED } from '../src/v2/sectors'
import type { Policy } from '../src/v2/types'
import { applyDecision, Game, keepPolicyAction } from '../src/v2/sim/game'
import { decisionSchema, describeObservation, parseDecision, systemPrompt } from '../src/v2/sim/llm'
import { Scripted } from '../src/v2/sim/scripted'
import type { DecisionAction, Leader, Observation } from '../src/v2/sim/types'
import { DEFAULT_CONFIG } from '../src/v2/sim/types'
import { createWorld } from '../src/v2/world'
import { callLlm, estimateCost, isFatalLlmError, isLocalModel, listModels } from '../server/providers'

const ROOT = resolve(import.meta.dirname, '..')
const argv = process.argv.slice(2)
const opt = (k: string, d: string) => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d
}
const models = opt('models', '').split(',').map((s) => s.trim()).filter(Boolean)
const repeats = Number(opt('repeats', '3'))
const dry = argv.includes('--dry')
if (!models.length && !dry) {
  console.log('사용법: npm run quiz:v2 -- --models claude-haiku-5-5[,다른 모델] [--repeats 3] [--yes] | --dry')
  process.exit(1)
}

// ── 상황 만들기: 대본대로 움직이는 6개국으로 2분기를 진행하고, 대한민국이 3분기 결정 때 받는 관측을 쓴다 ──
// 1분기: 한국이 중국·일본에 "참가국 모두 전자 관세 5% 이하"를 제안하고 둘 다 수락한다 (중동·미국·대만은 받지 않음).
//        한국은 중국산 반도체 관세를 20%로 올리고, 대만에 대한 기계 수출 통제를 1단계로 건다. 한국 → 일본 비공개 메시지.
// 2분기: 중국이 한국산 전자 관세를 15%로 올려 약속을 어긴다.
const SEMI = sectorIndex('semiconductors')
const ELEC = sectorIndex('electronics')
const MACH = sectorIndex('machinery')
const FOOD = sectorIndex('food')
let captured: Observation | null = null
const leaders = Object.fromEntries(BLOCS.map((b) => [b, new Scripted()])) as unknown as Record<BlocId, Leader>
leaders.A = new Scripted(
  (obs) =>
    obs.quarter === 0
      ? {
          messages: [{ to: 'C', text: '전자 관세를 함께 낮추자.', tone: 'cooperative' }],
          proposals: [{ to: ['B', 'C'], terms: [{ obligor: 'all', kind: 'tariff_max', goods: ['electronics'], value: 5 }], durationQuarters: 8, note: '전자 관세 상한' }],
        }
      : {},
  (obs, a) => {
    if (obs.quarter === 2) captured = obs
    if (obs.quarter === 0) {
      a.policy.tariffsPct.B!.semiconductors = 20
      a.policy.exportControls.F!.machinery = 1
      for (const j of ['B', 'C'] as const) a.policy.tariffsPct[j]!.electronics = Math.min(5, a.policy.tariffsPct[j]!.electronics)
    }
  },
)
const accept = (obs: Observation, a: DecisionAction) => {
  if (obs.quarter === 0) a.acceptProposals = obs.pendingProposals.map((p) => p.id)
  if (obs.quarter === 0) a.policy.tariffsPct.A!.electronics = Math.min(5, a.policy.tariffsPct.A!.electronics)
}
leaders.B = new Scripted(undefined, (obs, a) => {
  accept(obs, a)
  if (obs.quarter === 0) a.policy.tariffsPct.C!.electronics = Math.min(5, a.policy.tariffsPct.C!.electronics)
  if (obs.quarter >= 1) a.policy.tariffsPct.A!.electronics = 15
})
leaders.C = new Scripted(undefined, (obs, a) => {
  accept(obs, a)
  if (obs.quarter === 0) a.policy.tariffsPct.B!.electronics = Math.min(5, a.policy.tariffsPct.B!.electronics)
})
await new Game({ ...DEFAULT_CONFIG, years: 1 }, leaders, createWorld()).run()
const obs = captured as Observation | null
if (!obs) throw new Error('상황 만들기 실패: 관측 없음')
const own = obs.policies.A
const violation = obs.violations.find((v) => v.obligor === 'B')
const commitment = obs.commitments.find((c) => c.obligor === 'A')
if (!violation || !commitment || own.exportControls.F[MACH] !== 1) throw new Error('상황 만들기 실패')
const bound = [...new Set(obs.commitments.filter((c) => c.proposalId === commitment.proposalId).map((c) => c.obligor))].sort()
const GOOD_IDS = TRADED.map((s) => s.id)
const PARTNERS = BLOCS.filter((b) => b !== 'A')

// ── 질문 ──
type Q = { key: string; text: string; schema: Record<string, unknown>; answer: unknown }
const lvl = { type: 'integer', enum: [0, 1, 2, 3] }
const bloc = { type: 'string', enum: BLOCS }
const yn = { type: 'string', enum: ['예', '아니오'] }
const QUESTIONS: Q[] = [
  { key: 'own_tariff_B_semis', text: '지금 우리(대한민국)가 중국산 반도체에 매기는 관세는 몇 %인가? (숫자만)', schema: { type: 'number' }, answer: tariffPct(own.tariffs.B[SEMI]) },
  { key: 'B_tariff_on_us_elec', text: '지금 중국이 우리(대한민국)산 전자·정밀기기에 매기는 관세는 몇 %인가?', schema: { type: 'number' }, answer: tariffPct(obs.policies.B.tariffs.A[ELEC]) },
  { key: 'own_control_F_mach', text: '지금 우리가 대만에 거는 기계 수출 통제는 몇 단계인가?', schema: lvl, answer: own.exportControls.F[MACH] },
  { key: 'E_control_B_semis', text: '지금 미국이 중국에 거는 반도체 수출 통제는 몇 단계인가?', schema: lvl, answer: obs.policies.E.exportControls.B[SEMI] },
  { key: 'controlled_partners', text: '지금 우리가 수출 통제(1단계 이상)를 걸고 있는 상대국의 키(A~F)를 모두 적어라.', schema: { type: 'array', items: bloc }, answer: PARTNERS.filter((j) => own.exportControls[j].some((x) => x > 0)) },
  { key: 'dir_control', text: '어떤 물품의 수출 통제를 0단계에서 1단계로 바꾸면, 통제를 강화한 것인가 완화한 것인가?', schema: { type: 'string', enum: ['강화', '완화', '변화 없음'] }, answer: '강화' },
  { key: 'dir_tariff', text: '관세를 5%에서 5.5%로 바꾸면 인상인가 인하인가?', schema: { type: 'string', enum: ['인상', '인하', '변화 없음'] }, answer: '인상' },
  { key: 'violator', text: '최근 약속 위반 목록에서 약속을 어긴 나라의 키는?', schema: bloc, answer: violation.obligor },
  { key: 'bound_countries', text: `제안 ${commitment.proposalId}로 생긴 약속에 묶인 나라의 키를 모두 적어라.`, schema: { type: 'array', items: bloc }, answer: bound },
  { key: 'raise_D_elec_violates', text: '우리가 중동산 전자·정밀기기 관세를 20%로 올리면 우리 약속을 어기는 것인가?', schema: yn, answer: '아니오' },
  { key: 'cap_C_elec', text: '약속을 지키려면 우리가 일본산 전자·정밀기기에 매길 수 있는 관세는 최대 몇 %인가?', schema: { type: 'number' }, answer: commitment.value },
  { key: 'comparator', text: '상대 이익 목표라면 지금 우리의 비교 대상(우리를 뺀 AI 5개국 중 명목 GDP 1위)은 어느 나라인가? 키로 답하라.', schema: bloc, answer: largestOther(obs.latest, 'A') },
  { key: 'private_seen_by_B', text: '1분기에 우리가 일본에 보낸 비공개 메시지를 중국이 볼 수 있는가?', schema: yn, answer: '아니오' },
  { key: 'full_ban_level', text: '수출 전면 금지는 수출 통제 몇 단계인가?', schema: lvl, answer: 3 },
]
const quizSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['scratch', ...QUESTIONS.map((q) => q.key)],
  properties: { scratch: { type: 'string', description: '확인 메모 (짧게)' }, ...Object.fromEntries(QUESTIONS.map((q) => [q.key, q.schema])) },
}
const quizText = `\n\n# 지금 할 일: 확인 질문 (정책 결정이 아니다)
위 규칙과 현재 상황표만 보고 아래 질문에 답하라. JSON 키는 질문 앞의 키를 쓴다.
${QUESTIONS.map((q, i) => `${i + 1}. [${q.key}] ${q.text}`).join('\n')}`

// ── 실행 과제 ──
type Task = { key: string; text: string; check: (p: Policy) => string[] }
const same = (a: number, b: number) => Math.abs(a - b) < 1e-6
const keepRest = (p: Policy, except: (kind: 'tariff' | 'control', j: BlocId, g: number) => boolean) => {
  const bad: string[] = []
  for (const j of PARTNERS)
    GOOD_IDS.forEach((id, g) => {
      if (!except('tariff', j, g) && !same(p.tariffs[j][g], own.tariffs[j][g])) bad.push(`${j}.${id} 관세 ${tariffPct(own.tariffs[j][g])}→${tariffPct(p.tariffs[j][g])}`)
      if (!except('control', j, g) && p.exportControls[j][g] !== own.exportControls[j][g]) bad.push(`${j}.${id} 통제 ${own.exportControls[j][g]}→${p.exportControls[j][g]}`)
    })
  if (!same(p.investmentRate, own.investmentRate)) bad.push(`투자율 ${own.investmentRate * 100}→${p.investmentRate * 100}`)
  return bad
}
const semiNow = tariffPct(own.tariffs.B[SEMI])
const foodE = tariffPct(own.tariffs.E[FOOD])
const foodTarget = Math.round((foodE + 5) * 10) / 10
const TASKS: Task[] = [
  {
    key: 'cut_B_semis',
    text: `이번 분기에는 중국산 반도체 관세만 ${semiNow}%에서 10%로 내려라. 나머지 정책(다른 모든 관세, 모든 수출 통제, 투자율)은 현재 값 그대로 쓴다. 제안은 수락하지 않는다.`,
    check: (p) => [...(same(tariffPct(p.tariffs.B[SEMI]), 10) ? [] : [`B.semiconductors 관세 ${tariffPct(p.tariffs.B[SEMI])}% (정답 10%)`]), ...keepRest(p, (k, j, g) => k === 'tariff' && j === 'B' && g === SEMI)],
  },
  {
    key: 'ease_F_raise_E_food',
    text: `이번 분기에는 대만에 대한 기계 수출 통제를 0단계로 낮추고, 미국산 식품 관세를 ${foodE}%에서 ${foodTarget}%로 올려라. 나머지 정책은 현재 값 그대로 쓴다. 제안은 수락하지 않는다.`,
    check: (p) => [
      ...(p.exportControls.F[MACH] === 0 ? [] : [`F.machinery 통제 ${p.exportControls.F[MACH]} (정답 0)`]),
      ...(same(tariffPct(p.tariffs.E[FOOD]), foodTarget) ? [] : [`E.food 관세 ${tariffPct(p.tariffs.E[FOOD])}% (정답 ${foodTarget}%)`]),
      ...keepRest(p, (k, j, g) => (k === 'control' && j === 'F' && g === MACH) || (k === 'tariff' && j === 'E' && g === FOOD)),
    ],
  },
]

const view = describeObservation(obs)
const keep = keepPolicyAction(own, 'A').policy
const policyJson = JSON.stringify({ tariffs_pct: keep.tariffsPct, export_controls: keep.exportControls, investment_rate_pct: keep.investmentRatePct })
const taskPrompt = (t: Task) => `${view}\n\n# 현재 우리 정책 (출력 형식 그대로)\n${policyJson}\n\n# 지금 할 일: 이번 분기 정책 결정\n${t.text}`
const system = systemPrompt('A', 'absolute', 'real', 'shown', 16, 16)

if (dry) {
  for (const q of QUESTIONS) console.log(`[${q.key}] ${q.text} → ${JSON.stringify(q.answer)}`)
  for (const t of TASKS) console.log(`[${t.key}] ${t.text}`)
  console.log(`\n관측 ${view.length}자, 시스템 ${system.length}자`)
  process.exit(0)
}

// ── 비용 추정 (experiment-v2.ts와 같은 1.07자/토큰) ──
const tok = (chars: number) => Math.round(chars / 1.07)
const sysQuiz = tok(system.length + JSON.stringify(quizSchema).length)
const sysTask = tok(system.length + JSON.stringify(decisionSchema('A')).length)
for (const model of models) {
  const usd =
    estimateCost(model, { input_tokens: tok(view.length + quizText.length) * repeats, cache_creation_input_tokens: sysQuiz, cache_read_input_tokens: sysQuiz * (repeats - 1), output_tokens: 1500 * repeats }) +
    estimateCost(model, { input_tokens: tok(taskPrompt(TASKS[0]).length) * TASKS.length * repeats, cache_creation_input_tokens: sysTask, cache_read_input_tokens: sysTask * (TASKS.length * repeats - 1), output_tokens: 3000 * TASKS.length * repeats })
  console.log(`${model}: 호출 ${(1 + TASKS.length) * repeats}회, 추정 ${isLocalModel(model) ? '무료 (로컬)' : `$${usd.toFixed(3)}`}`)
}
const paid = models.filter((m) => !isLocalModel(m))
if (paid.length && !argv.includes('--yes')) {
  console.log('계획만 출력했습니다. 돌리려면 --yes 를 붙이세요.')
  process.exit(0)
}
for (const m of paid) if (!listModels().some((x) => x.id === m && x.available)) throw new Error(`${m}: .env에 키가 없습니다`)

// ── 실행 ──
const norm = (x: unknown) => (Array.isArray(x) ? [...x].map(String).sort().join(',') : typeof x === 'string' ? x.trim() : x)
const correct = (q: Q, got: unknown) => (typeof q.answer === 'number' ? typeof got === 'number' && Math.abs(got - q.answer) < 1e-6 : norm(got) === norm(q.answer))

interface ModelResult {
  model: string
  at: string
  repeats: number
  questions: Record<string, { correct: number; answers: unknown[] }>
  tasks: Record<string, { passed: number; errors: string[][] }>
  failedCalls: number
  latencyMs: number[]
  costUsd: number
}
const results: ModelResult[] = []
for (const model of models) {
  const r: ModelResult = {
    model,
    at: new Date().toISOString(),
    repeats,
    questions: Object.fromEntries(QUESTIONS.map((q) => [q.key, { correct: 0, answers: [] }])),
    tasks: Object.fromEntries(TASKS.map((t) => [t.key, { passed: 0, errors: [] }])),
    failedCalls: 0,
    latencyMs: [],
    costUsd: 0,
  }
  for (let i = 0; i < repeats; i++) {
    const res = await callLlm({ model, system, user: view + quizText, schema: quizSchema, effort: 'medium' })
    if (isFatalLlmError(res.error)) {
      console.error(`멈춤 ${model}: ${res.error!.slice(0, 120)}. 보고서는 바꾸지 않았습니다.`)
      process.exit(1)
    }
    r.latencyMs.push(res.latencyMs)
    r.costUsd += estimateCost(model, res.usage) || 0
    if (!res.ok || !res.json) {
      r.failedCalls++
      console.error(`  응답 실패 (확인 질문): ${res.error ?? '빈 응답'}`.slice(0, 300))
    }
    const j = (res.json ?? {}) as Record<string, unknown>
    for (const q of QUESTIONS) {
      r.questions[q.key].answers.push(j[q.key] ?? null)
      if (correct(q, j[q.key])) r.questions[q.key].correct++
    }
    for (const t of TASKS) {
      const tr = await callLlm({ model, system, user: taskPrompt(t), schema: decisionSchema('A'), effort: 'medium' })
      r.latencyMs.push(tr.latencyMs)
      r.costUsd += estimateCost(model, tr.usage) || 0
      const d = tr.ok ? parseDecision(tr.json, 'A') : null
      if (!d) {
        r.failedCalls++
        console.error(`  응답 실패 (실행 과제 ${t.key}): ${tr.error ?? '결정 형식 아님'}`.slice(0, 300))
        r.tasks[t.key].errors.push(['응답 해석 실패'])
        continue
      }
      const errs = t.check(applyDecision(own, d, 'A').policy) // 게임과 같은 방식으로 적용 (범위 보정 포함)
      r.tasks[t.key].errors.push(errs)
      if (!errs.length) r.tasks[t.key].passed++
    }
    console.log(`${model} ${i + 1}/${repeats}: 질문 ${QUESTIONS.filter((q) => correct(q, j[q.key])).length}/${QUESTIONS.length}, 누적 $${r.costUsd.toFixed(3)}`)
  }
  results.push(r)
}

// ── 저장 (모델별로 덮어쓰기) ──
const jsonPath = resolve(ROOT, 'reports/quiz-v2.json')
const all: ModelResult[] = existsSync(jsonPath) ? JSON.parse(readFileSync(jsonPath, 'utf8')) : []
for (const r of results) {
  const i = all.findIndex((x) => x.model === r.model)
  if (i >= 0) all[i] = r
  else all.push(r)
}
writeFileSync(jsonPath, JSON.stringify(all, null, 2))

const pctOf = (n: number, d: number) => `${Math.round((100 * n) / d)}%`
const md: string[] = ['# v2 규칙 이해도 검사', '']
md.push('지도자와 같은 시스템 프롬프트와 2라운드 관측(대한민국, 3분기)을 주고 정답이 정해진 질문과 실행 과제를 물었다. `npm run quiz:v2`로 다시 만든다.', '')
md.push('상황: 1분기에 한국이 중국·일본과 "참가국 모두 전자 관세 5% 이하" 약속을 맺고(중동·미국·대만은 비참가), 중국산 반도체 관세를 20%로 올리고 대만에 대한 기계 수출 통제를 1단계로 걸었다. 2분기에 중국이 한국산 전자 관세를 15%로 올려 약속을 어겼다.', '')
md.push(`| 질문 | 정답 | ${all.map((r) => `${r.model} (n=${r.repeats})`).join(' | ')} |`, `|---|---|${all.map(() => '---').join('|')}|`)
for (const q of QUESTIONS)
  md.push(`| ${q.text} | ${Array.isArray(q.answer) ? q.answer.join(', ') : q.answer} | ${all.map((r) => (r.questions[q.key] ? `${pctOf(r.questions[q.key].correct, r.repeats)} (${r.questions[q.key].answers.map((a) => JSON.stringify(a)).join(' ')})` : '-')).join(' | ')} |`)
md.push(`| **질문 합계** | | ${all.map((r) => `**${pctOf(Object.values(r.questions).reduce((s, x) => s + x.correct, 0), r.repeats * QUESTIONS.length)}**`).join(' | ')} |`)
for (const t of TASKS)
  md.push(`| 실행: ${t.text} | | ${all.map((r) => (r.tasks[t.key] ? `${pctOf(r.tasks[t.key].passed, r.repeats)}${r.tasks[t.key].errors.find((e) => e.length) ? ` (예: ${r.tasks[t.key].errors.find((e) => e.length)!.slice(0, 3).join('; ')})` : ''}` : '-')).join(' | ')} |`)
md.push(`| 응답 실패 | | ${all.map((r) => r.failedCalls).join(' | ')} |`)
md.push(`| 평균 응답 시간 | | ${all.map((r) => `${(r.latencyMs.reduce((s, x) => s + x, 0) / r.latencyMs.length / 1000).toFixed(0)}초`).join(' | ')} |`)
md.push(`| 비용 | | ${all.map((r) => `$${(r.costUsd ?? 0).toFixed(3)}`).join(' | ')} |`)
writeFileSync(resolve(ROOT, 'reports/quiz-v2.md'), md.join('\n') + '\n')
console.log('reports/quiz-v2.md, reports/quiz-v2.json')
