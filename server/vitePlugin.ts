// 개발 서버에 붙는 API. 키는 이 Node 프로세스에만 있고 브라우저로 나가지 않는다.
//   GET  /api/models  모델 목록과 키 유무 (설치된 로컬 Ollama 모델 포함)
//   POST /api/llm     LlmRequest → LlmResponse
//   POST /api/runs    브라우저에서 끝난 게임 로그(JSONL)를 runs/ui/ 에 저장

import { mkdirSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import type { LlmRequest } from '../src/sim/llmTypes.ts'
import { PROJECT_ROOT } from './env.ts'
import { callLlm, isLocalModel, listAllModels, listModels } from './providers.ts'

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

export function apiPlugin(): Plugin {
  return {
    name: 'trade-sim-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0]
        try {
          if (url === '/api/models' && req.method === 'GET') return send(res, 200, await listAllModels())
          if (url === '/api/llm' && req.method === 'POST') {
            const body = JSON.parse(await readBody(req)) as LlmRequest
            if (!isLocalModel(body.model) && !listModels().some((m) => m.id === body.model)) return send(res, 400, { ok: false, error: `알 수 없는 모델: ${body.model}` })
            return send(res, 200, await callLlm(body))
          }
          if (url === '/api/runs' && req.method === 'POST') {
            const { name, jsonl } = JSON.parse(await readBody(req)) as { name: string; jsonl: string }
            const dir = resolve(PROJECT_ROOT, 'runs', 'ui')
            mkdirSync(dir, { recursive: true })
            const file = resolve(dir, `${name.replace(/[^\w.-]/g, '_')}.jsonl`)
            writeFileSync(file, jsonl)
            return send(res, 200, { ok: true, file: file.slice(PROJECT_ROOT.length + 1) })
          }
        } catch (err) {
          return send(res, 500, { ok: false, error: String(err) })
        }
        next()
      })
    },
  }
}
