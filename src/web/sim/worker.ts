// 정책 실험 계산 스레드. 16분기 계산(약 0.3초)이 도는 동안 화면이 멈추지 않게 한다
import { simulate, type Change } from './scenario'

self.onmessage = (e: MessageEvent<{ id: number; changes: Change[] }>) => {
  const { id, changes } = e.data
  try {
    postMessage({ id, result: simulate(changes) })
  } catch (err) {
    postMessage({ id, error: String(err) })
  }
}
