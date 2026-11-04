// 프로젝트 .env 만 읽는다. 셸 환경변수(ANTHROPIC_API_KEY 등)는 일부러 쓰지 않는다:
// 개발 도구가 물려준 키로 유료 실험이 몰래 돌지 않게 하기 위해서다.

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let cache: Record<string, string> | null = null

export function projectEnv(): Record<string, string> {
  if (cache) return cache
  const out: Record<string, string> = {}
  const file = resolve(PROJECT_ROOT, '.env')
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
      if (!m) continue
      let v = m[2]
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
      out[m[1]] = v
    }
  }
  cache = out
  return out
}
