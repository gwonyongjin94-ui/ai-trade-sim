// LLM 호출 (Node 전용). 브라우저는 /api/llm 을 거치고, 배치 실험 스크립트는 이 함수를 직접 부른다.
//
// 키는 프로젝트 .env 에서만 읽는다:
//   ANTHROPIC_API_KEY=...            (Claude)
//   OPENAI_COMPAT_API_KEY=...         (선택: OpenAI 호환 API로 다른 회사 모델 비교)
//   OPENAI_COMPAT_BASE_URL=https://api.openai.com/v1
//   OPENAI_COMPAT_MODELS=gpt-5.1,gpt-5-mini
//   LLM_FALLBACKS=off                 (선택: Claude 서버 측 폴백 끄기)
//
// 무료 로컬 모델: 이 컴퓨터에서 도는 Ollama 서버 (키 없음, 요금 없음). 모델 id는 'ollama:<이름>' (예: ollama:exaone3.5:7.8b).
// 설치된 모델은 Ollama에서 자동으로 읽는다. 선택 설정:
//   OLLAMA_BASE_URL=http://127.0.0.1:11434
//   OLLAMA_NUM_CTX=16384              (문맥 길이. 기본값이 짧으면 긴 프롬프트가 조용히 잘린다)
//   OLLAMA_THINK=on                   (사고 모드가 있는 모델이 답 전에 따로 생각하게 함. 기본은 끔:
//                                      모든 모델이 JSON의 reasoning 칸에서만 생각하게 해서 모델끼리 조건을 맞춘다)

import Anthropic from '@anthropic-ai/sdk'
import type { LlmRequest, LlmResponse, ModelInfo } from '../src/sim/llmTypes.ts'
import { projectEnv } from './env.ts'

// 셸에서 물려받은 ANTHROPIC_* 변수(키, 프록시 주소, 커스텀 헤더)를 SDK가 몰래 집어 가지 않도록 지운다
for (const k of Object.keys(process.env)) if (k.startsWith('ANTHROPIC_')) delete process.env[k]

// 100만 토큰당 달러 (입력, 출력, 캐시 읽기). 비용 추정용
export const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'claude-fable-5-1': { input: 10, output: 50, cacheRead: 0.25 },
}

const CLAUDE_MODELS: { id: string; label: string }[] = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1' },
]

const compatModels = () =>
  (projectEnv().OPENAI_COMPAT_MODELS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

export const LOCAL_PREFIX = 'ollama:'
export const isLocalModel = (id: string) => id.startsWith(LOCAL_PREFIX)
const ollamaBase = () => (projectEnv().OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, '')

// Ollama에 설치된 모델 이름. 서버가 꺼져 있으면 빈 목록
export async function localModels(): Promise<string[]> {
  try {
    const r = await fetch(`${ollamaBase()}/api/tags`, { signal: AbortSignal.timeout(1000) })
    const body = (await r.json()) as { models?: { name: string }[] }
    return (body.models ?? []).map((m) => m.name)
  } catch {
    return []
  }
}

// Claude·OpenAI 호환 모델 + 지금 설치된 로컬 모델
export async function listAllModels(): Promise<ModelInfo[]> {
  const local = (await localModels()).map((name) => ({ id: LOCAL_PREFIX + name, label: `로컬 무료: ${name}`, provider: 'ollama' as const, available: true }))
  return [...listModels(), ...local]
}

export function listModels(): ModelInfo[] {
  const env = projectEnv()
  return [
    ...CLAUDE_MODELS.map((m) => ({ ...m, provider: 'anthropic' as const, available: !!env.ANTHROPIC_API_KEY })),
    ...compatModels().map((id) => ({ id, label: id, provider: 'openai-compatible' as const, available: !!env.OPENAI_COMPAT_API_KEY })),
  ]
}

let anthropic: Anthropic | null = null
function anthropicClient(): Anthropic {
  const apiKey = projectEnv().ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('.env에 ANTHROPIC_API_KEY가 없습니다')
  anthropic ??= new Anthropic({ apiKey, authToken: null, baseURL: 'https://api.anthropic.com' })
  return anthropic
}

const failure = (req: LlmRequest, started: number, error: string, extra: Partial<LlmResponse> = {}): LlmResponse => ({
  ok: false,
  json: null,
  text: '',
  model: req.model,
  requestedModel: req.model,
  stopReason: 'error',
  usage: {},
  fallback: false,
  latencyMs: Date.now() - started,
  error,
  ...extra,
})

async function callAnthropic(req: LlmRequest): Promise<LlmResponse> {
  const started = Date.now()
  const useFallbacks = projectEnv().LLM_FALLBACKS !== 'off'
  try {
    const res = await anthropicClient().beta.messages.create({
      model: req.model,
      max_tokens: req.maxTokens ?? 16000,
      ...(useFallbacks ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: req.user }],
      output_config: { effort: req.effort ?? 'medium', format: { type: 'json_schema', schema: req.schema } },
    })
    // 폴백이 일어나면 fallback 블록 뒤의 내용이 실제 답이다
    const lastFallback = res.content.map((b) => b.type).lastIndexOf('fallback')
    const text = res.content
      .slice(lastFallback + 1)
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
    const u = res.usage
    const usage = {
      input_tokens: u.input_tokens,
      output_tokens: u.output_tokens,
      cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
      cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
    }
    const base = {
      text,
      model: res.model,
      requestedModel: req.model,
      stopReason: res.stop_reason ?? 'unknown',
      usage,
      fallback: lastFallback >= 0,
      latencyMs: Date.now() - started,
    }
    if (res.stop_reason === 'refusal') return { ...base, ok: false, json: null, error: '모델이 응답을 거절함' }
    if (res.stop_reason === 'max_tokens') return { ...base, ok: false, json: null, error: '응답이 max_tokens에서 잘림' }
    try {
      return { ...base, ok: true, json: JSON.parse(text) }
    } catch {
      return { ...base, ok: false, json: null, error: 'JSON 파싱 실패' }
    }
  } catch (err) {
    const msg = err instanceof Anthropic.APIError ? `${err.status ?? ''} ${err.message}` : String(err)
    return failure(req, started, msg)
  }
}

// 다른 회사 모델 비교용 (OpenAI 호환 chat/completions + json_schema). 키가 있을 때만 쓰인다
async function callCompat(req: LlmRequest): Promise<LlmResponse> {
  const started = Date.now()
  const env = projectEnv()
  if (!env.OPENAI_COMPAT_API_KEY) return failure(req, started, '.env에 OPENAI_COMPAT_API_KEY가 없습니다')
  const base = (env.OPENAI_COMPAT_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, '')
  try {
    const r = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.OPENAI_COMPAT_API_KEY}` },
      body: JSON.stringify({
        model: req.model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'action', strict: true, schema: req.schema } },
      }),
    })
    const body = (await r.json()) as {
      model?: string
      choices?: { message?: { content?: string; refusal?: string }; finish_reason?: string }[]
      usage?: { prompt_tokens?: number; completion_tokens?: number }
      error?: { message?: string }
    }
    if (!r.ok) return failure(req, started, `${r.status} ${body.error?.message ?? ''}`)
    const choice = body.choices?.[0]
    const text = choice?.message?.content ?? ''
    const out = {
      text,
      model: body.model ?? req.model,
      requestedModel: req.model,
      stopReason: choice?.message?.refusal ? 'refusal' : (choice?.finish_reason ?? 'unknown'),
      usage: { input_tokens: body.usage?.prompt_tokens ?? 0, output_tokens: body.usage?.completion_tokens ?? 0 },
      fallback: false,
      latencyMs: Date.now() - started,
    }
    try {
      return { ...out, ok: true, json: JSON.parse(text) }
    } catch {
      return { ...out, ok: false, json: null, error: 'JSON 파싱 실패' }
    }
  } catch (err) {
    return failure(req, started, String(err))
  }
}

// 모델이 사고 모드를 지원하는지 (/api/show의 capabilities). 지원하지 않는 모델에 think를 보내면 오류가 난다
const thinkingSupport = new Map<string, Promise<boolean>>()
function supportsThinking(base: string, model: string): Promise<boolean> {
  if (!thinkingSupport.has(model))
    thinkingSupport.set(
      model,
      fetch(`${base}/api/show`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model }) })
        .then((r) => r.json() as Promise<{ capabilities?: string[] }>)
        .then((b) => (b.capabilities ?? []).includes('thinking'))
        .catch(() => false),
    )
  return thinkingSupport.get(model)!
}

// 로컬 Ollama. 네이티브 /api/chat을 쓴다: 문맥 길이(num_ctx)를 정할 수 있고 JSON 스키마로 출력을 제약한다.
// 응답 하나에 5분이 넘으면 Node fetch가 끊는다 (그러면 한 번 다시 묻고, 또 실패하면 현재 정책 유지).
async function callOllama(req: LlmRequest): Promise<LlmResponse> {
  const started = Date.now()
  const base = ollamaBase()
  const model = req.model.slice(LOCAL_PREFIX.length)
  try {
    const think = projectEnv().OLLAMA_THINK === 'on'
    const canThink = await supportsThinking(base, model)
    const r = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        format: req.schema,
        stream: false,
        keep_alive: '30m',
        ...(canThink ? { think } : {}),
        // num_predict: 같은 문장을 끝없이 반복하는 작은 모델이 5분 제한에 걸리지 않게 출력 길이를 막는다 (사고 모드면 생각까지 포함해 넉넉히)
        options: { num_ctx: Number(projectEnv().OLLAMA_NUM_CTX ?? 16384), num_predict: req.maxTokens ?? (think && canThink ? 12288 : 4096) },
      }),
    })
    const body = (await r.json()) as {
      model?: string
      message?: { content?: string; thinking?: string }
      done_reason?: string
      prompt_eval_count?: number
      eval_count?: number
      error?: string
    }
    if (!r.ok) return failure(req, started, `${r.status} ${body.error ?? ''}`)
    const text = body.message?.content ?? ''
    const out = {
      text,
      model: req.model,
      requestedModel: req.model,
      stopReason: body.done_reason ?? 'unknown',
      usage: { input_tokens: body.prompt_eval_count ?? 0, output_tokens: body.eval_count ?? 0 },
      fallback: false,
      latencyMs: Date.now() - started,
    }
    try {
      return { ...out, ok: true, json: JSON.parse(text) }
    } catch {
      return { ...out, ok: false, json: null, error: `JSON 파싱 실패 (${body.done_reason === 'length' ? '출력 길이 초과' : '형식 오류'})` }
    }
  } catch (err) {
    return failure(req, started, `Ollama(${base}) 호출 실패: ${String(err)}`)
  }
}

export function callLlm(req: LlmRequest): Promise<LlmResponse> {
  if (req.model.startsWith('claude-')) return callAnthropic(req)
  if (isLocalModel(req.model)) return callOllama(req)
  return callCompat(req)
}

export function estimateCost(model: string, usage: Record<string, number>): number {
  if (isLocalModel(model)) return 0
  const p = PRICES[model]
  if (!p) return NaN
  const uncached = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) * 1.25
  return (uncached * p.input + (usage.cache_read_input_tokens ?? 0) * p.cacheRead + (usage.output_tokens ?? 0) * p.output) / 1e6
}
