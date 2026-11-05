// v2 배치 실험 (6개국). 기본은 계획과 비용 추정만 출력한다 (돈이 들지 않음). 실제로 돌리려면 --yes.
//
//   npm run experiment:v2 -- --name v2-pilot --models claude-haiku-5-5                 (계획과 비용만)
//   npm run experiment:v2 -- --name v2-pilot --models claude-haiku-5-5 --yes           (유료 실행)
//   npm run experiment:v2 -- --name v2-mock --mock --repeats 2 --yes                   (가짜 응답, 무료)
//   npm run experiment:v2 -- --name v2-rules --rules-only --yes                        (규칙 지도자, 무료)
//
// 옵션
//   --models a,b        6자리 모두 같은 모델인 판을 모델마다. 무료 로컬 모델은 ollama:<이름>
//   --mock              6자리 모두 가짜 응답 (src/v2/sim/mock.ts). 기록·측정·보고서 점검용, 연구 결과로 쓰지 않는다
//   --rules-only        6자리 모두 같은 규칙인 판 (status-quo, free-trade, tit-for-tat). 결정론적이라 반복 1회
//   --seat E=rule:provocateur,B=rule:tit-for-tat   특정 자리만 바꾼다 (모든 판에 적용). 값: 모델 id, mock, rule:<규칙>
//   --objectives all-A,all-R,AAARAA   6개국 목표 (A = 절대 이익, R = 상대 이익, 순서는 A~F = 한국·중국·일본·중동·미국·대만)
//   --naming real,abstract      나라 이름: 실제 / A~F
//   --culture shown,hidden      지도자 프롬프트에 Hofstede 문화 지표 있음 / 없음
//   --recap off,on              지난 분기 우리나라의 실제 정책 변화를 알려주지 않음 / 알려줌
//   --repeats 1  --years 4  --effort medium  --concurrency 1 (동시에 돌리는 판 수. 한 판 안에서 6개국은 늘 동시에 부른다)
// 결과: runs/<name>/<run>.jsonl (이벤트 한 줄씩), runs/<name>/manifest.json
// 이미 끝난 런은 건너뛰므로 중단 후 같은 명령으로 이어서 돌릴 수 있다. API 키는 프로젝트 .env에서만 읽는다 (server/providers.ts).

import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Effort, LlmTransport } from '../src/sim/llmTypes'
import type { CultureBrief } from '../src/v2/culture'
import type { ObjectiveKind } from '../src/v2/objectives'
import { BLOCS } from '../src/v2/regions'
import type { BlocId, RegionNaming } from '../src/v2/regions'
import { Game } from '../src/v2/sim/game'
import { decisionSchema, diplomacySchema, LlmLeader, systemPrompt } from '../src/v2/sim/llm'
import { mockTransport } from '../src/v2/sim/mock'
import { RuleLeader } from '../src/v2/sim/rules'
import type { RuleKind } from '../src/v2/sim/rules'
import type { GameConfig, Leader, Recap } from '../src/v2/sim/types'
import { createWorld } from '../src/v2/world'
import { callLlm, estimateCost, isFatalLlmError, isLocalModel, listModels, localModels, PRICES } from '../server/providers'

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
const oneOf = <T extends string>(k: string, xs: T[], allowed: T[]) => {
  for (const x of xs) if (!allowed.includes(x)) throw new Error(`--${k} 값은 ${allowed.join(', ')} 중 하나: ${x}`)
  return xs
}

const name = opt('name', `v2-${new Date().toISOString().slice(0, 10)}`)
const mock = flag('mock')
const rulesOnly = flag('rules-only')
const models = mock ? ['mock'] : list('models', '')
const objectiveKeys = list('objectives', 'all-A')
const namings = oneOf('naming', list('naming', 'real') as RegionNaming[], ['real', 'abstract'])
const cultures = oneOf('culture', list('culture', 'shown') as CultureBrief[], ['shown', 'hidden'])
const recaps = oneOf('recap', list('recap', 'off') as Recap[], ['off', 'on'])
const years = Number(opt('years', '4'))
const effort = opt('effort', 'medium') as Effort
const concurrency = Number(opt('concurrency', '1'))
const repeats = rulesOnly ? 1 : Number(opt('repeats', '1'))
const HOMOGENEOUS_RULES: RuleKind[] = ['status-quo', 'free-trade', 'tit-for-tat']
const ALL_RULES: RuleKind[] = [...HOMOGENEOUS_RULES, 'provocateur']

const seatOverrides: Partial<Record<BlocId, string>> = {}
for (const s of list('seat', '')) {
  const m = /^([A-F])=(.+)$/.exec(s)
  if (!m) throw new Error(`--seat 형식은 E=rule:provocateur: ${s}`)
  seatOverrides[m[1] as BlocId] = m[2]
}

const known = new Set(listModels().map((m) => m.id))
const checkSeat = (s: string) => {
  if (s === 'mock') return
  if (s.startsWith('rule:')) {
    if (!ALL_RULES.includes(s.slice(5) as RuleKind)) throw new Error(`알 수 없는 규칙: ${s} (${ALL_RULES.join(', ')})`)
    return
  }
  if (!known.has(s) && !isLocalModel(s)) throw new Error(`알 수 없는 모델: ${s} (server/providers.ts 목록, .env의 OPENAI_COMPAT_MODELS, 또는 로컬 ollama:<이름>)`)
}
for (const s of [...models, ...Object.values(seatOverrides)]) checkSeat(s)

const objectivesOf = (key: string): Record<BlocId, ObjectiveKind> => {
  const letters = key === 'all-A' ? 'AAAAAA' : key === 'all-R' ? 'RRRRRR' : key
  if (!/^[AR]{6}$/.test(letters)) throw new Error(`--objectives 값은 all-A, all-R 또는 A·R 6글자(A~F 순서): ${key}`)
  return Object.fromEntries(BLOCS.map((b, i) => [b, letters[i] === 'A' ? 'absolute' : 'relative'])) as Record<BlocId, ObjectiveKind>
}
for (const k of objectiveKeys) objectivesOf(k)

// ── 계획 ──
interface RunSpec {
  id: string
  seats: Record<BlocId, string>
  objectives: string
  naming: RegionNaming
  culture: CultureBrief
  recap: Recap
  repeat: number
}

const slug = (s: string) => s.replace(/^claude-/, '').replace(/^rule:/, '').replace(/[^\w.-]+/g, '_')
const lineups: { label: string; seats: Record<BlocId, string> }[] = []
const seated = (base: string) => Object.fromEntries(BLOCS.map((b) => [b, seatOverrides[b] ?? base])) as Record<BlocId, string>
const overrideLabel = Object.entries(seatOverrides)
  .map(([b, s]) => `${b}_${slug(s)}`)
  .join('-')
if (rulesOnly) for (const r of HOMOGENEOUS_RULES) lineups.push({ label: slug(r), seats: seated(`rule:${r}`) })
else for (const m of models) lineups.push({ label: slug(m), seats: seated(m) })
if (lineups.length === 0) {
  console.log('대결 조합이 없습니다. --models, --mock, --rules-only 중 하나를 주세요.')
  process.exit(1)
}

const plan: RunSpec[] = []
for (const objectives of objectiveKeys)
  for (const naming of namings)
    for (const culture of cultures)
      for (const recap of recaps)
        for (const { label, seats } of lineups)
          for (let r = 1; r <= repeats; r++)
            plan.push({
              id: `${objectives}-${naming}-${culture}${recap === 'on' ? '-recap' : ''}-${label}${overrideLabel ? `-${overrideLabel}` : ''}-r${String(r).padStart(2, '0')}`,
              seats,
              objectives,
              naming,
              culture,
              recap,
              repeat: r,
            })
// 반복 우선 순서: 모든 조건의 1회차, 모든 조건의 2회차 … (중간에 멈춰도 조건별 판 수가 고르게 남는다)
plan.sort((a, b) => a.repeat - b.repeat)

// ── 비용 추정 ──
// 가짜 응답으로 한 판을 돌려 호출마다 실제 프롬프트 길이를 잰다. 토큰은 한국어+표 기준 약 1.07자/토큰
// (v1 Haiku 런의 실제 사용량에서 잰 값, 2026-11-05). 실제 메시지는 가짜(약 20자)보다 길어(v1 Haiku 평균 250자) 관측에 호출당
// 6,000자를 더한다 (관측에 보이는 최근 3분기 성명·메시지 약 25개 × 230자).
// 출력은 외교 약 1,000토큰, 결정 약 2,500토큰(정책표 100칸 + 이유)으로 본다. 시스템 프롬프트 + 응답 형식은 캐시된다.
const CHARS_PER_TOKEN = 1.07
const MESSAGE_MARGIN = 6000
const OUTPUT = { diplomacy: 1000, decision: 2500 }
const world = createWorld()
const totalQuarters = years * 4

async function measurePrompts(): Promise<{ diplomacy: { system: number; user: number }; decision: { system: number; user: number } }> {
  const sums = { diplomacy: { system: 0, user: 0, n: 0 }, decision: { system: 0, user: 0, n: 0 } }
  const config: GameConfig = { years, termYears: 4, objectives: objectivesOf('all-A'), naming: 'real', culture: 'shown', recap: 'off' }
  const leaders = Object.fromEntries(
    BLOCS.map((c) => {
      const inner = mockTransport('probe', c)
      const transport: LlmTransport = async (req) => {
        const k = 'proposals' in (req.schema.properties as object) ? 'diplomacy' : 'decision'
        sums[k].system += req.system.length + JSON.stringify(req.schema).length
        sums[k].user += req.user.length + MESSAGE_MARGIN
        sums[k].n++
        return inner(req)
      }
      return [c, new LlmLeader({ model: 'mock', transport, naming: 'real', culture: 'shown', objective: 'absolute', country: c, termQuarters: 16, totalQuarters })]
    }),
  ) as unknown as Record<BlocId, Leader>
  await new Game(config, leaders, world).run()
  const avg = (s: { system: number; user: number; n: number }) => ({ system: Math.round(s.system / s.n / CHARS_PER_TOKEN), user: Math.round(s.user / s.n / CHARS_PER_TOKEN) })
  return { diplomacy: avg(sums.diplomacy), decision: avg(sums.decision) }
}

const isPaid = (s: string) => s !== 'mock' && !s.startsWith('rule:') && !isLocalModel(s)
const isLlm = (s: string) => s !== 'mock' && !s.startsWith('rule:')
const llmSeats = (spec: RunSpec) => BLOCS.filter((b) => isLlm(spec.seats[b])).map((b) => spec.seats[b])

const dir = resolve(ROOT, 'runs', name)
const done = (id: string) => {
  const f = resolve(dir, `${id}.jsonl`)
  return existsSync(f) && readFileSync(f, 'utf8').includes('"type":"end"')
}
const todo = plan.filter((s) => !done(s.id))

console.log(`실험 ${name}: 런 ${plan.length}개 (남은 것 ${todo.length}개), ${years}년 = ${totalQuarters}분기, effort ${effort}`)
console.log(`자리: ${lineups.map((l) => BLOCS.map((b) => `${b}=${l.seats[b]}`).join(' ')).join(' | ')}`)
console.log(`목표: ${objectiveKeys.join(', ')} · 나라 이름: ${namings.join(', ')} · 문화 지표: ${cultures.join(', ')} · 실제 변화 알림: ${recaps.join(', ')} · 반복 ${repeats}`)

const usedModels = [...new Set(plan.flatMap(llmSeats))]
if (usedModels.length) {
  const per = await measurePrompts()
  console.log(
    `\n호출 1회 추정 토큰: 외교 = 시스템·형식 ${per.diplomacy.system}(캐시) + 관측 ${per.diplomacy.user} + 출력 ${OUTPUT.diplomacy}, ` +
      `결정 = 시스템·형식 ${per.decision.system}(캐시) + 관측 ${per.decision.user} + 출력 ${OUTPUT.decision}`,
  )
  let total = 0
  for (const model of usedModels) {
    let calls = 0
    let usd = 0
    for (const spec of todo) {
      const seats = llmSeats(spec).filter((m) => m === model).length
      if (!seats) continue
      calls += seats * totalQuarters * 2
      for (const k of ['diplomacy', 'decision'] as const) {
        usd += estimateCost(model, {
          input_tokens: per[k].user * seats * totalQuarters,
          cache_creation_input_tokens: per[k].system * seats, // 나라마다 시스템 프롬프트가 달라 자리마다 한 번씩 만든다
          cache_read_input_tokens: per[k].system * seats * (totalQuarters - 1),
          output_tokens: OUTPUT[k] * seats * totalQuarters,
        })
      }
    }
    if (isLocalModel(model)) console.log(`  ${model}: 호출 ${calls}회, 무료 (로컬)`)
    else {
      console.log(`  ${model}: 남은 호출 ${calls}회, 추정 $${usd.toFixed(2)}${PRICES[model] ? '' : ' (가격 정보 없음)'}`)
      if (Number.isFinite(usd)) total += usd
    }
  }
  console.log(`  합계 추정 $${total.toFixed(2)} (남은 런 기준. 실제와 1.5배 정도 차이 날 수 있음)`)
}

if (!flag('yes')) {
  console.log('\n계획만 출력했습니다. 실제로 돌리려면 같은 명령 끝에 --yes 를 붙이세요.')
  process.exit(0)
}
const paid = usedModels.filter(isPaid)
if (paid.length && !listModels().some((m) => m.available && paid.includes(m.id))) {
  console.log('\n.env에 API 키가 없습니다. .env.example을 복사해 키를 넣으세요.')
  process.exit(1)
}
const local = usedModels.filter(isLocalModel)
if (local.length) {
  const installed = await localModels()
  const missing = local.filter((m) => !installed.includes(m.slice('ollama:'.length)))
  if (missing.length) {
    console.log(installed.length ? `\n설치되지 않은 로컬 모델: ${missing.join(', ')}.` : '\nOllama 서버에 연결하지 못했습니다. Ollama 앱을 켜 두세요.')
    process.exit(1)
  }
}

// ── 실행 ──
// 프롬프트 버전: 6개국 시스템 프롬프트(절대·상대) + 응답 형식의 해시
const promptHash = createHash('sha256')
  .update(
    BLOCS.flatMap((b) => [systemPrompt(b, 'absolute', 'real', 'shown', 16, totalQuarters), systemPrompt(b, 'relative', 'abstract', 'hidden', 16, totalQuarters)]).join('') +
      JSON.stringify(decisionSchema('A')) +
      JSON.stringify(diplomacySchema('A')),
  )
  .digest('hex')
  .slice(0, 12)
const code = (() => {
  try {
    const commit = execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    const dirty = execSync('git status --porcelain', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() !== ''
    return { commit, dirty }
  } catch {
    return { commit: 'unknown', dirty: true }
  }
})()
if (code.dirty && paid.length) console.log(`\n주의: 커밋하지 않은 코드 변경이 있습니다 (커밋 ${code.commit}). 본 실험이면 먼저 커밋하세요.`)
mkdirSync(dir, { recursive: true })
const manifestPath = resolve(dir, 'manifest.json')
const prevManifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null
const invocation = { at: new Date().toISOString(), argv, code, promptHash }
writeFileSync(
  manifestPath,
  JSON.stringify(
    {
      name,
      version: 2,
      createdAt: prevManifest?.createdAt ?? invocation.at,
      argv,
      years,
      effort,
      promptHash,
      code,
      fallbacks: 'see .env LLM_FALLBACKS',
      invocations: [...(prevManifest?.invocations ?? []), invocation],
      plan,
    },
    null,
    2,
  ),
)

function leaderFor(seat: string, c: BlocId, config: GameConfig, runId: string): Leader {
  if (seat.startsWith('rule:')) return new RuleLeader(seat.slice(5) as RuleKind)
  return new LlmLeader({
    model: seat,
    transport: seat === 'mock' ? mockTransport(runId, c) : callLlm,
    naming: config.naming,
    culture: config.culture,
    recap: config.recap,
    objective: config.objectives[c],
    country: c,
    termQuarters: config.termYears * 4,
    totalQuarters: config.years * 4,
    effort,
    logPrompts: seat !== 'mock',
  })
}

class FatalRunError extends Error {}

async function runOne(spec: RunSpec) {
  const file = resolve(dir, `${spec.id}.jsonl`)
  rmSync(file, { force: true }) // 중간에 끊긴 런은 처음부터
  const config: GameConfig = { years, termYears: 4, objectives: objectivesOf(spec.objectives), naming: spec.naming, culture: spec.culture, recap: spec.recap }
  const leaders = Object.fromEntries(BLOCS.map((c) => [c, leaderFor(spec.seats[c], c, config, spec.id)])) as Record<BlocId, Leader>
  const game = new Game(config, leaders, world)
  appendFileSync(file, JSON.stringify({ type: 'run', version: 2, spec, promptHash, code }) + '\n')
  let cost = 0
  let fatal: string | null = null
  game.onEvent((e) => {
    appendFileSync(file, JSON.stringify(e) + '\n')
    if ((e.type === 'diplomacy' || e.type === 'decision') && !fatal && isFatalLlmError(e.meta?.error)) {
      fatal = e.meta!.error!
      game.stop()
    }
    if ((e.type === 'diplomacy' || e.type === 'decision') && e.meta?.usage && e.meta.model) cost += estimateCost(e.meta.requestedModel ?? e.meta.model, e.meta.usage) || 0
    if (e.type === 'quarter' && (e.quarter + 1) % 4 === 0) console.log(`  ${spec.id}: ${e.quarter + 1}/${totalQuarters}분기, 비용 $${cost.toFixed(3)}`)
  })
  const t = Date.now()
  await game.run()
  if (fatal) {
    renameSync(file, `${file}.failed`) // .jsonl이 아니면 보고서·기록부가 읽지 않고, 이어 돌리면 처음부터 다시 한다
    throw new FatalRunError(fatal)
  }
  console.log(`완료 ${spec.id} (${((Date.now() - t) / 1000).toFixed(0)}초, $${cost.toFixed(3)})`)
}

const queue = [...todo]
let aborted = null as string | null
await Promise.all(
  Array.from({ length: Math.max(1, concurrency) }, async () => {
    for (let s = queue.shift(); s && !aborted; s = queue.shift()) {
      try {
        await runOne(s)
      } catch (err) {
        console.error(`실패 ${s.id}: ${String(err)}`)
        if (err instanceof FatalRunError) aborted = err.message
      }
    }
  }),
)
if (aborted) {
  console.error(`\n멈춤: 다시 불러도 같은 오류가 날 문제입니다 (${aborted.slice(0, 120)}). .env의 키·크레딧·모델 이름을 확인하고 같은 명령으로 다시 돌리세요.`)
  process.exit(1)
}
console.log(`\n끝. 보고서: npm run report:v2 -- ${name}`)
