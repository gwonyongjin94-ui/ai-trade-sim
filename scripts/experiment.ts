// 배치 실험. 기본은 계획과 비용 추정만 출력한다 (돈이 들지 않음). 실제로 돌리려면 --yes.
//
//   npm run experiment -- --name pilot --models claude-haiku-5-5 --objectives AA --repeats 2
//   npm run experiment -- --name pilot --models claude-haiku-5-5 --objectives AA --repeats 2 --yes
//   npm run experiment -- --name rules --rules-only --yes          (규칙 대통령끼리, 무료)
//
// 옵션
//   --models a,b        같은 모델끼리 대결 (a vs a, b vs b). 무료 로컬 모델은 ollama:<이름> (예: ollama:exaone3.5:7.8b)
//   --cross             서로 다른 모델끼리도 대결 (a vs b, b vs a — 나라 자리 바꿔서)
//   --vs-rules r1,r2    LLM 대 규칙 대통령 (free-trade, status-quo, tit-for-tat, nash), 자리 바꿔서
//   --rules-only        규칙 대통령끼리 모든 조합 (결정론적이라 반복 1회)
//   --objectives AA,RR,AR,RA   A국·B국 목표 (A = 절대 이익, R = 상대 이익)
//   --naming real,abstract      물품 실제 이름 / 익명 (WarAgent식 비교)
//   --culture shown,hidden      대통령 프롬프트에 두 나라 문화 설명 있음 / 없음 (경제 수치의 문화 차이는 항상 있음)
//   --recap off,on              지난 분기 우리나라가 실제로 한 일(정책 변화와 확전점수)을 대통령에게 알려주지 않음 / 알려줌
//   --repeats 10  --years 12  --effort medium  --concurrency 2
// 결과: runs/<name>/<run>.jsonl (이벤트 한 줄씩), runs/<name>/manifest.json
// 이미 끝난 런은 건너뛰므로 중단 후 같은 명령으로 이어서 돌릴 수 있다.

import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { CultureBrief } from '../src/engine/culture'
import type { Naming } from '../src/engine/goods'
import type { ObjectiveKind } from '../src/engine/objectives'
import type { CountryId } from '../src/engine/types'
import { createWorld } from '../src/engine/world'
import type { BaselineData } from '../src/sim/baseline'
import { comboKey } from '../src/sim/baseline'
import { Game } from '../src/sim/game'
import { decisionSchema, describeObservation, diplomacySchema, LlmLeader, systemPrompt } from '../src/sim/llm'
import type { Effort } from '../src/sim/llmTypes'
import { RuleLeader } from '../src/sim/rules'
import type { RuleKind } from '../src/sim/rules'
import type { GameConfig, Leader, Recap } from '../src/sim/types'
import { projectEnv } from '../server/env'
import { callLlm, estimateCost, isLocalModel, listModels, localModels, PRICES } from '../server/providers'

const ROOT = resolve(import.meta.dirname, '..')

// ── 인자 ──
const argv = process.argv.slice(2)
const flag = (k: string) => argv.includes(`--${k}`)
const opt = (k: string, d: string) => {
  const i = argv.indexOf(`--${k}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d
}
const list = (k: string, d: string) =>
  opt(k, d)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

const name = opt('name', `exp-${new Date().toISOString().slice(0, 10)}`)
const models = list('models', '')
const vsRules = list('vs-rules', '') as RuleKind[]
const objectiveKeys = list('objectives', 'AA')
const namings = list('naming', 'real') as Naming[]
const cultures = list('culture', 'shown') as CultureBrief[]
for (const c of cultures) if (c !== 'shown' && c !== 'hidden') throw new Error(`--culture 값은 shown, hidden 중 하나: ${c}`)
const recaps = list('recap', 'off') as Recap[]
for (const x of recaps) if (x !== 'off' && x !== 'on') throw new Error(`--recap 값은 off, on 중 하나: ${x}`)
const years = Number(opt('years', '12'))
const effort = opt('effort', 'medium') as Effort
const concurrency = Number(opt('concurrency', models.some(isLocalModel) ? '1' : '2')) // 로컬 모델은 한 번에 하나씩
const rulesOnly = flag('rules-only')
const repeats = rulesOnly ? 1 : Number(opt('repeats', '10'))
const ALL_RULES: RuleKind[] = ['free-trade', 'status-quo', 'tit-for-tat', 'nash']

const known = new Set(listModels().map((m) => m.id))
for (const m of models) if (!known.has(m) && !isLocalModel(m)) throw new Error(`알 수 없는 모델: ${m} (server/providers.ts 목록, .env의 OPENAI_COMPAT_MODELS, 또는 로컬 ollama:<이름>)`)

const objectivesOf = (key: string): Record<CountryId, ObjectiveKind> => {
  if (!/^[AR]{2}$/.test(key)) throw new Error(`--objectives 값은 AA, RR, AR, RA 중 하나: ${key}`)
  return { A: key[0] === 'A' ? 'absolute' : 'relative', B: key[1] === 'A' ? 'absolute' : 'relative' }
}

// ── 계획 ──
interface RunSpec {
  id: string
  A: string
  B: string
  objectives: string
  naming: Naming
  culture: CultureBrief
  recap?: Recap // 없으면 off (이 조건을 넣기 전 런)
  repeat: number
}

const pairs: [string, string][] = []
if (rulesOnly) {
  for (const a of ALL_RULES) for (const b of ALL_RULES) pairs.push([`rule:${a}`, `rule:${b}`])
} else {
  for (const m of models) pairs.push([m, m])
  if (flag('cross')) for (const a of models) for (const b of models) if (a !== b) pairs.push([a, b])
  for (const m of models)
    for (const r of vsRules) {
      pairs.push([m, `rule:${r}`])
      pairs.push([`rule:${r}`, m])
    }
}
if (pairs.length === 0) {
  console.log('대결 조합이 없습니다. --models 또는 --rules-only 를 주세요.')
  process.exit(1)
}

const LOCAL_SECONDS_PER_CALL = 60
const slug = (s: string) => s.replace(/^claude-/, '').replace(/[^\w.-]+/g, '_')
const plan: RunSpec[] = []
for (const objectives of objectiveKeys)
  for (const naming of namings)
    for (const culture of cultures)
      for (const recap of recaps)
        for (const [A, B] of pairs)
          for (let r = 1; r <= repeats; r++)
            plan.push({
              // off는 예전 런 id와 같게 둔다 (이어 돌리기)
              id: `${objectives}-${naming}-${culture}${recap === 'on' ? '-recap' : ''}-${slug(A)}-vs-${slug(B)}-r${String(r).padStart(2, '0')}`,
              A,
              B,
              objectives,
              naming,
              culture,
              recap,
              repeat: r,
            })

// 반복 우선 순서: 모든 조건의 1회차, 모든 조건의 2회차 … (중간에 멈춰도 조건별 판 수가 고르게 남는다)
plan.sort((a, b) => a.repeat - b.repeat)

// ── 비용 추정 ──
// 토큰 수는 프롬프트 글자 수로 대충 잡는다 (한국어+표 기준 약 1.6자/토큰). 파일럿을 돌린 뒤 report의 실제 비용을 보라.
const world = createWorld()
const totalQuarters = years * 4
const probe = new Game({ years, termYears: 4, objectives: objectivesOf('AA'), naming: 'real', culture: 'shown', realtime: null }, { A: new RuleLeader('status-quo'), B: new RuleLeader('status-quo') }, world)
const sys = systemPrompt('A', 'absolute', 'real', 'shown', 16, totalQuarters)
const userChars = describeObservation(probe.observation('A', 2)).length + 2500 // 기록·메시지가 쌓인 뒤를 감안
const schemaChars = JSON.stringify(decisionSchema('real')).length + JSON.stringify(diplomacySchema('real')).length / 2
const tok = (chars: number) => Math.round(chars / 1.6)
const perCall = { system: tok(sys.length + schemaChars), user: tok(userChars), output: 1800 }

function llmCalls(spec: RunSpec) {
  return [spec.A, spec.B].filter((s) => !s.startsWith('rule:')).map((m) => ({ model: m, calls: totalQuarters * 2 }))
}
const costByModel = new Map<string, { calls: number; usd: number }>()
for (const spec of plan) {
  for (const { model, calls } of llmCalls(spec)) {
    const usage = {
      input_tokens: perCall.user * calls,
      cache_creation_input_tokens: perCall.system * 2, // 대통령 교체와 무관하게 시스템 프롬프트는 같다 (라운드별 스키마 2종)
      cache_read_input_tokens: perCall.system * calls,
      output_tokens: perCall.output * calls,
    }
    const cur = costByModel.get(model) ?? { calls: 0, usd: 0 }
    cur.calls += calls
    cur.usd += estimateCost(model, usage)
    costByModel.set(model, cur)
  }
}

const dir = resolve(ROOT, 'runs', name)
const done = (id: string) => {
  const f = resolve(dir, `${id}.jsonl`)
  return existsSync(f) && readFileSync(f, 'utf8').includes('"type":"end"')
}
const todo = plan.filter((s) => !done(s.id))

console.log(`실험 ${name}: 런 ${plan.length}개 (남은 것 ${todo.length}개), ${years}년 = ${totalQuarters}분기, effort ${effort}`)
console.log(`조합: ${pairs.map(([a, b]) => `${a} vs ${b}`).join(' | ')}`)
console.log(`목표: ${objectiveKeys.join(', ')} · 물품 이름: ${namings.join(', ')} · 문화 설명: ${cultures.join(', ')} · 실제 변화 알림: ${recaps.join(', ')} · 반복 ${repeats}`)
if (costByModel.size) {
  console.log(`\n호출 1회 추정 토큰: 시스템 ${perCall.system} (캐시) + 관측 ${perCall.user} + 출력(사고 포함) ${perCall.output}`)
  let total = 0
  for (const [model, { calls, usd }] of costByModel) {
    const p = PRICES[model]
    if (isLocalModel(model)) {
      console.log(`  ${model}: 호출 ${calls}회, 무료 (로컬). 예상 시간 약 ${((calls * LOCAL_SECONDS_PER_CALL) / 3600 / concurrency).toFixed(1)}시간 (호출당 ${LOCAL_SECONDS_PER_CALL}초 가정, 기기·모델에 따라 다름)`)
      continue
    }
    console.log(`  ${model}: 호출 ${calls}회, 추정 $${usd.toFixed(2)}${p ? '' : ' (가격 정보 없음)'}`)
    if (Number.isFinite(usd)) total += usd
  }
  console.log(`  합계 추정 $${total.toFixed(2)} (전체 계획 기준, 실제와 2배 정도 차이 날 수 있음)`)
}

if (!flag('yes')) {
  console.log('\n계획만 출력했습니다. 실제로 돌리려면 같은 명령 끝에 --yes 를 붙이세요.')
  process.exit(0)
}
const remote = [...costByModel.keys()].filter((m) => !isLocalModel(m))
if (remote.length && !listModels().some((m) => m.available && remote.includes(m.id))) {
  console.log('\n.env에 API 키가 없습니다. .env.example을 복사해 키를 넣으세요.')
  process.exit(1)
}
const local = [...costByModel.keys()].filter(isLocalModel)
if (local.length) {
  const installed = await localModels()
  const missing = local.filter((m) => !installed.includes(m.slice('ollama:'.length)))
  if (missing.length) {
    console.log(installed.length ? `\n설치되지 않은 로컬 모델: ${missing.join(', ')}. 터미널에서 ollama pull <이름> 으로 받으세요.` : '\nOllama 서버에 연결하지 못했습니다. Ollama 앱을 켜 두세요 (https://ollama.com/download).')
    process.exit(1)
  }
}

// ── 실행 ──
const baseline = JSON.parse(readFileSync(resolve(ROOT, 'src/data/baseline.json'), 'utf8')) as BaselineData
const promptHash = createHash('sha256')
  .update(systemPrompt('A', 'absolute', 'real', 'shown', 16, totalQuarters) + JSON.stringify(decisionSchema('real')) + JSON.stringify(diplomacySchema('real')))
  .digest('hex')
  .slice(0, 12)
// 코드 버전: git 커밋과 커밋 안 된 변경 여부. 결과가 어떤 코드에서 나왔는지 런마다 남긴다
const code = (() => {
  try {
    const commit = execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    const dirty = execSync('git status --porcelain', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() !== ''
    return { commit, dirty }
  } catch {
    return { commit: 'unknown', dirty: true }
  }
})()
if (code.dirty) console.log(`\n주의: 커밋하지 않은 코드 변경이 있습니다 (커밋 ${code.commit}). 본 실험이면 먼저 커밋하세요.`)
const ollamaEnv = { OLLAMA_NUM_CTX: projectEnv().OLLAMA_NUM_CTX ?? '16384', OLLAMA_THINK: projectEnv().OLLAMA_THINK ?? 'off' }
mkdirSync(dir, { recursive: true })
// 이어 돌리면 처음 만든 시각은 두고 실행 기록만 덧붙인다
const manifestPath = resolve(dir, 'manifest.json')
const prevManifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null
const invocation = { at: new Date().toISOString(), argv, code, promptHash, ollamaEnv }
writeFileSync(
  manifestPath,
  JSON.stringify(
    {
      name,
      createdAt: prevManifest?.createdAt ?? invocation.at,
      argv,
      years,
      effort,
      promptHash,
      code,
      ollamaEnv,
      fallbacks: 'see .env LLM_FALLBACKS',
      invocations: [...(prevManifest?.invocations ?? []), invocation],
      plan,
    },
    null,
    2,
  ),
)

function leaderFor(spec: string, c: CountryId, config: GameConfig): Leader {
  if (spec.startsWith('rule:')) {
    const rule = spec.slice(5) as RuleKind
    const nash = rule === 'nash' ? baseline.nash[comboKey(config.objectives)].static!.policies[c] : null
    return new RuleLeader(rule, nash)
  }
  return new LlmLeader({
    model: spec,
    transport: callLlm,
    naming: config.naming,
    culture: config.culture,
    recap: config.recap,
    objective: config.objectives[c],
    country: c,
    termQuarters: config.termYears * 4,
    totalQuarters: config.years * 4,
    effort,
    logPrompts: true,
  })
}

async function runOne(spec: RunSpec) {
  const file = resolve(dir, `${spec.id}.jsonl`)
  rmSync(file, { force: true }) // 중간에 끊긴 런은 처음부터
  const config: GameConfig = { years, termYears: 4, objectives: objectivesOf(spec.objectives), naming: spec.naming, culture: spec.culture, recap: spec.recap ?? 'off', realtime: null }
  const game = new Game(config, { A: leaderFor(spec.A, 'A', config), B: leaderFor(spec.B, 'B', config) }, world)
  appendFileSync(file, JSON.stringify({ type: 'run', spec, promptHash, code, ollamaEnv }) + '\n')
  let cost = 0
  game.onEvent((e) => {
    appendFileSync(file, JSON.stringify(e) + '\n')
    if ((e.type === 'diplomacy' || e.type === 'decision') && e.meta?.usage && e.meta.model) cost += estimateCost(e.meta.requestedModel ?? e.meta.model, e.meta.usage) || 0
    if (e.type === 'quarter' && (e.quarter + 1) % 8 === 0) console.log(`  ${spec.id}: ${e.quarter + 1}/${totalQuarters}분기, 비용 $${cost.toFixed(3)}`)
  })
  const t = Date.now()
  await game.run()
  console.log(`완료 ${spec.id} (${((Date.now() - t) / 1000).toFixed(0)}초, $${cost.toFixed(3)})`)
}

const queue = [...todo]
await Promise.all(
  Array.from({ length: Math.max(1, concurrency) }, async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      try {
        await runOne(s)
      } catch (err) {
        console.error(`실패 ${s.id}: ${String(err)}`)
      }
    }
  }),
)
console.log(`\n끝. 보고서: npm run report -- ${name}`)
