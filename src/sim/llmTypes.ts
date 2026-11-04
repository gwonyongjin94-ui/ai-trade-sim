// 브라우저와 서버가 함께 쓰는 LLM 호출 형식. API 키는 서버(Node)에만 있다.

export type Effort = 'low' | 'medium' | 'high'

export interface LlmRequest {
  model: string
  system: string
  user: string
  schema: Record<string, unknown>
  maxTokens?: number
  effort?: Effort
}

export interface LlmResponse {
  ok: boolean
  json: unknown
  text: string
  model: string // 실제로 응답한 모델 (폴백이 일어나면 요청 모델과 다를 수 있음)
  requestedModel: string
  stopReason: string
  usage: Record<string, number>
  fallback: boolean
  latencyMs: number
  error?: string
}

export type LlmTransport = (req: LlmRequest) => Promise<LlmResponse>

export interface ModelInfo {
  id: string
  label: string
  provider: 'anthropic' | 'openai-compatible' | 'ollama'
  available: boolean // 키가 .env에 있는지 (로컬 모델은 설치되어 있으면 항상)
}

// 브라우저용: Vite 개발 서버의 /api/llm 으로 보낸다
export const httpTransport: LlmTransport = async (req) => {
  const res = await fetch('/api/llm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(req),
  })
  return (await res.json()) as LlmResponse
}
