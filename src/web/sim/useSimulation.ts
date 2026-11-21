// 시나리오 결과를 Web Worker에서 받아 온다. 같은 변경 목록은 한 번만 계산한다
import { useEffect, useState } from 'react'
import type { Change, QuarterOut } from './scenario'

type Reply = { id: number; result?: QuarterOut[]; error?: string }

let worker: Worker | null = null
let nextId = 1
const waiting = new Map<number, (r: Reply) => void>()
const cache = new Map<string, Promise<QuarterOut[]>>()

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<Reply>) => {
      waiting.get(e.data.id)?.(e.data)
      waiting.delete(e.data.id)
    }
  }
  return worker
}

export function runScenario(changes: Change[]): Promise<QuarterOut[]> {
  const key = JSON.stringify(changes)
  let p = cache.get(key)
  if (!p) {
    p = new Promise<QuarterOut[]>((resolve, reject) => {
      const id = nextId++
      waiting.set(id, (r) => (r.result ? resolve(r.result) : reject(new Error(r.error ?? '계산 실패'))))
      getWorker().postMessage({ id, changes })
    })
    p.catch(() => cache.delete(key))
    cache.set(key, p)
  }
  return p
}

export function useSimulation(changes: Change[]): { result: QuarterOut[] | null; error: string | null } {
  const key = JSON.stringify(changes)
  const [state, setState] = useState<{ key: string; result: QuarterOut[] | null; error: string | null }>({ key, result: null, error: null })
  useEffect(() => {
    let live = true
    runScenario(JSON.parse(key) as Change[]).then(
      (result) => live && setState({ key, result, error: null }),
      (e: unknown) => live && setState({ key, result: null, error: String(e) }),
    )
    return () => { live = false }
  }, [key])
  return state.key === key ? state : { result: null, error: null }
}
