// 이론 기준선 데이터 형식. scripts/baseline.ts 가 src/data/baseline.json 으로 만든다.

import type { ObjectiveKind } from '../engine/objectives'
import type { CountryId, Policy } from '../engine/types'

export interface CountryPath {
  livingStandard: number[]
  realGdp: number[]
  avgTariff: number[]
  shortage: number[]
  capital: number[]
  termLs: number[] // 임기별 평균 생활수준
  termScores: Record<ObjectiveKind, number[]> // 임기별 목표 점수 (그 정책을 계속 유지했을 때)
}

export interface BenchmarkPath {
  label: string
  policies: Record<CountryId, Policy>
  A: CountryPath
  B: CountryPath
  converged?: boolean
  rounds?: number
}

export interface BaselineData {
  generatedAt: string
  years: number
  termQuarters: number
  freeTrade: BenchmarkPath
  statusQuo: BenchmarkPath
  nash: Record<string, { static?: BenchmarkPath; dynamic?: BenchmarkPath }> // 키: comboKey
}

// 목표 조합 → 'AA' | 'RR' | 'AR' | 'RA' (A국 목표, B국 목표 순. A = 절대, R = 상대)
export const comboKey = (o: Record<CountryId, ObjectiveKind>) => (o.A === 'absolute' ? 'A' : 'R') + (o.B === 'absolute' ? 'A' : 'R')
