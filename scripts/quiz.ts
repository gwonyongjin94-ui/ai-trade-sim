// 규칙 이해도 검사: 모델이 게임 규칙과 현재 상황표를 제대로 읽는지, 지시한 정책을 숫자로 제대로 쓰는지 본다.
//   npm run quiz -- --models ollama:exaone3.5:7.8b --repeats 3
//   npm run quiz -- --dry          질문·정답·과제만 출력 (모델 호출 없음)
// 대통령과 똑같은 시스템 프롬프트와 관측(A국, 3분기)을 주고
//  - 확인 질문 11개 (정답이 관측에서 계산된다)
//  - 실행 과제 2개 (말로 지시한 정책 변경을 결정 JSON으로 쓰기)
// 를 묻는다. 로컬 시험판(2026-11-03)에서 대통령이 수출 통제를 올리고 "완화했다"고 적은 일이 계기다.
// 유료 모델은 --yes가 있어야 호출한다 (모델당 3회 × 반복).
// 결과: reports/quiz.md, reports/quiz.json (모델별로 덮어씀)

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ProposalTerm } from '../src/engine/diplomacy'
import { GOOD_IDS, goodIndex } from '../src/engine/goods'
import type { CountryId, Policy } from '../src/engine/types'
import { createWorld } from '../src/engine/world'
import { DEFAULT_CONFIG } from '../src/sim/types'
import type { DecisionAction, DiplomacyAction, Leader, Observation } from '../src/sim/types'
import { decisionSchema, describeObservation, parseDecision, systemPrompt } from '../src/sim/llm'
import { applyDecision, Game, keepPolicyAction } from '../src/sim/game'
import { callLlm, isLocalModel, listModels } from '../server/providers'

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
  console.log('사용법: npm run quiz -- --models ollama:exaone3.5:7.8b[,다른 모델] [--repeats 3] [--yes]')
  process.exit(1)
}
const paid = models.filter((m) => !isLocalModel(m))
if (paid.length && !argv.includes('--yes')) {
  console.log(`유료 모델(${paid.join(', ')})은 호출 ${3 * repeats}회씩 요금이 듭니다. 돌리려면 --yes 를 붙이세요.`)
  process.exit(1)
}
for (const m of paid) if (!listModels().some((x) => x.id === m && x.available)) throw new Error(`${m}: .env에 키가 없습니다`)

// ── 상황 만들기: 대본대로 움직이는 두 대통령으로 2분기를 진행하고, A국이 3분기 결정 때 받는 관측을 쓴다 ──
// 1분기: A가 "양국 가전제품 수출 통제 1단계 이하"를, B가 "양국 모든 관세 0% 이하"를 제안하고 서로 수락한다.
//        A는 산업기계·전자부품 관세를 2%로 내리고 수출 통제를 1단계로 올린다.
// 2분기: A는 산업기계·전자부품 관세를 2.5%로 올린다. 양국 모두 관세 0% 약속을 어긴다.
const M = goodIndex('machinery')
const E = goodIndex('electronics')
class Scripted implements Leader {
  kind = 'rule' as const
  label = 'quiz:scripted'
  captured: Observation | null = null
  private c: CountryId
  private proposal: ProposalTerm
  private edit: (q: number, a: DecisionAction) => void
  constructor(c: CountryId, proposal: ProposalTerm, edit: (q: number, a: DecisionAction) => void) {
    this.c = c
    this.proposal = proposal
    this.edit = edit
  }
  async diplomacy(obs: Observation): Promise<{ action: DiplomacyAction }> {
    return { action: { message: '', tone: 'neutral', proposals: obs.quarter === 0 ? [{ terms: [this.proposal], durationQuarters: 4, note: '' }] : [] } }
  }
  async decide(obs: Observation): Promise<{ action: DecisionAction }> {
    if (obs.quarter === 2 && this.c === 'A') this.captured = obs
    const a = keepPolicyAction(obs.policies[this.c])
    if (obs.quarter === 0) a.acceptProposals = obs.pendingProposals.map((p) => p.id)
    this.edit(obs.quarter, a)
    return { action: a }
  }
}
const A = new Scripted('A', { obligor: 'both', kind: 'export_control_max', goods: ['appliances'], value: 1 }, (q, a) => {
  if (q === 0) {
    a.policy.tariffsPct.machinery = a.policy.tariffsPct.electronics = 2
    a.policy.exportControls.machinery = a.policy.exportControls.electronics = 1
  }
  if (q === 1) a.policy.tariffsPct.machinery = a.policy.tariffsPct.electronics = 2.5
})
const B = new Scripted('B', { obligor: 'both', kind: 'tariff_max', goods: ['all'], value: 0 }, () => {})
await new Game({ ...DEFAULT_CONFIG, years: 1 }, { A, B }, createWorld()).run()
const obs = A.captured!
const own = obs.policies.A
const violated = obs.violations.find((v) => v.obligor === 'A')
if (!violated || own.exportControls[M] !== 1) throw new Error('상황 만들기 실패')

// ── 질문 ──
type Q = { key: string; text: string; schema: Record<string, unknown>; answer: unknown }
const lvl = { type: 'integer', minimum: 0, maximum: 3 }
const QUESTIONS: Q[] = [
  { key: 'own_control_machinery', text: '지금 우리(A국) 산업기계 수출 통제는 몇 단계인가?', schema: lvl, answer: own.exportControls[M] },
  { key: 'rival_control_machinery', text: '지금 B국 산업기계 수출 통제는 몇 단계인가?', schema: lvl, answer: obs.policies.B.exportControls[M] },
  { key: 'own_tariff_machinery', text: '지금 우리 산업기계 관세는 몇 %인가? (숫자만)', schema: { type: 'number' }, answer: Math.round(own.tariffs[M] * 1000) / 10 },
  { key: 'controlled_goods', text: '지금 우리가 수출 통제(1단계 이상)를 걸고 있는 물품의 키를 모두 적어라.', schema: { type: 'array', items: { type: 'string', enum: GOOD_IDS } }, answer: GOOD_IDS.filter((_, g) => own.exportControls[g] > 0) },
  { key: 'dir_control', text: '어떤 물품의 수출 통제를 0단계에서 1단계로 바꾸면, 통제를 강화한 것인가 완화한 것인가?', schema: { type: 'string', enum: ['강화', '완화', '변화 없음'] }, answer: '강화' },
  { key: 'dir_tariff', text: '관세를 2%에서 2.5%로 바꾸면 인상인가 인하인가?', schema: { type: 'string', enum: ['인상', '인하', '변화 없음'] }, answer: '인상' },
  { key: 'must_change_appliances', text: '"가전제품 수출 통제 1단계 이하" 약속을 지키려면, 지금 우리 가전제품 수출 통제 단계를 바꿔야 하는가?', schema: { type: 'string', enum: ['예', '아니오'] }, answer: own.exportControls[goodIndex('appliances')] <= 1 ? '아니오' : '예' },
  { key: 'own_es_last', text: `${obs.history[obs.history.length - 1].quarter + 1}분기 우리 확전점수는 몇 점이었나?`, schema: { type: 'number' }, answer: obs.history[obs.history.length - 1].A.es },
  { key: 'violated_id', text: '최근 약속 위반 목록에서 우리(A국)가 어긴 약속의 ID는? (예: X1-1.1A)', schema: { type: 'string' }, answer: violated.commitmentId },
  { key: 'grain_tariff_cap', text: '우리가 어기고 있는 약속을 지키려면 곡물 관세를 최대 몇 %로 해야 하는가?', schema: { type: 'number' }, answer: 0 },
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
const keepRest = (p: Policy, except: (kind: 'tariff' | 'control', g: number) => boolean) => {
  const bad: string[] = []
  GOOD_IDS.forEach((id, g) => {
    if (!except('tariff', g) && !same(p.tariffs[g], own.tariffs[g])) bad.push(`${id} 관세 ${own.tariffs[g] * 100}→${p.tariffs[g] * 100}`)
    if (!except('control', g) && p.exportControls[g] !== own.exportControls[g]) bad.push(`${id} 통제 ${own.exportControls[g]}→${p.exportControls[g]}`)
  })
  if (!same(p.investmentRate, own.investmentRate)) bad.push(`투자율 ${own.investmentRate * 100}→${p.investmentRate * 100}`)
  return bad
}
const TASKS: Task[] = [
  {
    key: 'ease_controls',
    text: '이번 분기에는 산업기계와 전자부품의 수출 통제만 한 단계씩 낮춰라. 나머지 정책(모든 관세, 다른 물품의 수출 통제, 투자율)은 현재 값 그대로 쓴다. 제안은 수락하지 않는다.',
    check: (p) => [
      ...[M, E].filter((g) => p.exportControls[g] !== own.exportControls[g] - 1).map((g) => `${GOOD_IDS[g]} 통제 ${own.exportControls[g]}→${p.exportControls[g]} (정답 ${own.exportControls[g] - 1})`),
      ...keepRest(p, (kind, g) => kind === 'control' && (g === M || g === E)),
    ],
  },
  {
    key: 'comply_tariffs',
    text: '우리가 지금 어기고 있는 약속을 지키도록 관세만 고쳐라. 수출 통제와 투자율은 현재 값 그대로 쓴다. 제안은 수락하지 않는다.',
    check: (p) => [...GOOD_IDS.flatMap((id, g) => (p.tariffs[g] > 1e-9 ? [`${id} 관세 ${p.tariffs[g] * 100}% (정답 0%)`] : [])), ...keepRest(p, (kind) => kind === 'tariff')],
  },
]

if (dry) {
  for (const q of QUESTIONS) console.log(`[${q.key}] ${q.text} → ${JSON.stringify(q.answer)}`)
  for (const t of TASKS) console.log(`[${t.key}] ${t.text}`)
  console.log('\n--- 관측 (일부) ---\n' + describeObservation(obs).split('\n').filter((l) => /machinery|electronics|appliances|위반|약속|^- \[|^\| [0-9] /.test(l)).join('\n'))
  process.exit(0)
}

// ── 실행 ──
const system = systemPrompt('A', 'absolute', 'real', 'shown', 16, 48)
const view = describeObservation(obs)
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
  }
  for (let i = 0; i < repeats; i++) {
    const res = await callLlm({ model, system, user: view + quizText, schema: quizSchema, effort: 'medium' })
    r.latencyMs.push(res.latencyMs)
    if (!res.ok || !res.json) r.failedCalls++
    const j = (res.json ?? {}) as Record<string, unknown>
    for (const q of QUESTIONS) {
      r.questions[q.key].answers.push(j[q.key] ?? null)
      if (correct(q, j[q.key])) r.questions[q.key].correct++
    }
    for (const t of TASKS) {
      const tr = await callLlm({ model, system, user: `${view}\n\n# 지금 할 일: 이번 분기 정책 결정\n${t.text}`, schema: decisionSchema('real'), effort: 'medium' })
      r.latencyMs.push(tr.latencyMs)
      const d = tr.ok ? parseDecision(tr.json, 'real') : null
      if (!d) {
        r.failedCalls++
        r.tasks[t.key].errors.push(['응답 해석 실패'])
        continue
      }
      // 게임과 같은 방식으로 적용 (범위 보정 포함)
      const errs = t.check(applyDecision(own, d).policy)
      r.tasks[t.key].errors.push(errs)
      if (!errs.length) r.tasks[t.key].passed++
    }
    console.log(`${model} ${i + 1}/${repeats}: 질문 ${QUESTIONS.filter((q) => correct(q, j[q.key])).length}/${QUESTIONS.length}`)
  }
  results.push(r)
}

// ── 저장 (모델별로 덮어쓰기) ──
const jsonPath = resolve(ROOT, 'reports/quiz.json')
const all: ModelResult[] = existsSync(jsonPath) ? JSON.parse(readFileSync(jsonPath, 'utf8')) : []
for (const r of results) {
  const i = all.findIndex((x) => x.model === r.model)
  if (i >= 0) all[i] = r
  else all.push(r)
}
writeFileSync(jsonPath, JSON.stringify(all, null, 2))

const pctOf = (n: number, d: number) => `${Math.round((100 * n) / d)}%`
const md: string[] = ['# 규칙 이해도 검사', '']
md.push('대통령과 같은 시스템 프롬프트와 관측(A국, 3분기)을 주고 정답이 정해진 질문과 실행 과제를 물었다. `npm run quiz`로 다시 만든다.', '')
md.push('상황: 1분기에 A가 산업기계·전자부품 관세를 2%로 내리고 수출 통제를 1단계로 올렸다. 2분기에 그 관세를 2.5%로 올렸고, 양국 모두 "모든 관세 0% 이하" 약속을 어기고 있다.', '')
md.push(`| 질문 | 정답 | ${all.map((r) => `${r.model} (n=${r.repeats})`).join(' | ')} |`, `|---|---|${all.map(() => '---').join('|')}|`)
for (const q of QUESTIONS) md.push(`| ${q.text} | ${Array.isArray(q.answer) ? q.answer.join(', ') : q.answer} | ${all.map((r) => (r.questions[q.key] ? `${pctOf(r.questions[q.key].correct, r.repeats)} (${r.questions[q.key].answers.map((a) => JSON.stringify(a)).join(' ')})` : '-')).join(' | ')} |`)
md.push(`| **질문 합계** | | ${all.map((r) => `**${pctOf(Object.values(r.questions).reduce((s, x) => s + x.correct, 0), r.repeats * QUESTIONS.length)}**`).join(' | ')} |`)
for (const t of TASKS) md.push(`| 실행: ${t.text} | | ${all.map((r) => (r.tasks[t.key] ? `${pctOf(r.tasks[t.key].passed, r.repeats)}${r.tasks[t.key].errors.find((e) => e.length) ? ` (예: ${r.tasks[t.key].errors.find((e) => e.length)!.slice(0, 3).join('; ')})` : ''}` : '-')).join(' | ')} |`)
md.push(`| 응답 실패 | | ${all.map((r) => r.failedCalls).join(' | ')} |`)
md.push(`| 평균 응답 시간 | | ${all.map((r) => `${(r.latencyMs.reduce((s, x) => s + x, 0) / r.latencyMs.length / 1000).toFixed(0)}초`).join(' | ')} |`)
writeFileSync(resolve(ROOT, 'reports/quiz.md'), md.join('\n') + '\n')
console.log('reports/quiz.md, reports/quiz.json')
