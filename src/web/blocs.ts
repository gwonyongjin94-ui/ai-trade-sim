// 지도의 나라 ↔ 시뮬레이션 엔진의 지역. 엔진(src/v2)은 AI 지도자가 이끄는 블록 6개 + 나머지 세계로 계산한다.
// 회원국 목록은 data/v2/trade-2023.json의 블록 정의와 같다 (테스트로 확인). 튀르키예·이집트는 v2에서 빠져 나머지 세계다.

import { BLOCS, REGION_NAME, type BlocId, type RegionId } from '../v2/regions'
import { DATA } from './data'

export const MEMBERS: Record<BlocId, string[]> = {
  A: ['KOR'],
  B: ['CHN', 'PRK', 'HKG', 'MAC'],
  C: ['JPN'],
  D: ['SAU', 'ARE', 'QAT', 'KWT', 'OMN', 'BHR', 'IRN', 'IRQ', 'ISR', 'JOR', 'LBN', 'SYR', 'YEM'],
  E: ['USA', 'CAN', 'MEX'],
  F: ['TWN'],
}

// 블록을 대표하는 나라: 흐름선과 배지를 이 나라 자리에 놓는다
export const HOME: Record<BlocId, string> = { A: 'KOR', B: 'CHN', C: 'JPN', D: 'SAU', E: 'USA', F: 'TWN' }

const OF = new Map<string, BlocId>()
for (const b of BLOCS) for (const iso of MEMBERS[b]) OF.set(iso, b)

export const regionOf = (iso: string): RegionId => OF.get(iso) ?? 'R'
export const blocOf = (iso: string): BlocId | null => OF.get(iso) ?? null

// 짧은 이름 (대한민국, 중국, 일본, 중동, 미국, 대만, 나머지 세계)
export const regionName = (r: RegionId) => REGION_NAME[r].real

// 블록 이름 + 회원국. 한 나라 블록은 이름만
export function regionTitle(r: RegionId) {
  if (r === 'R') return '나머지 세계'
  return MEMBERS[r].length > 1 ? `${regionName(r)} 블록` : regionName(r)
}
export function regionMembers(r: RegionId) {
  if (r === 'R') return '블록 6개에 들지 않은 모든 나라 (유럽연합, 인도, 동남아시아, 러시아, 남미, 아프리카 등)'
  return MEMBERS[r].map((iso) => DATA.countries[iso]?.name ?? iso).join(', ')
}

// 같은 지역에 속한 지도 위 나라들
export function isosOf(r: RegionId): string[] {
  if (r !== 'R') return MEMBERS[r]
  return Object.keys(DATA.countries).filter((iso) => !OF.has(iso))
}

// 블록 색 (리플레이·시뮬레이션 범례에서 나라를 구별할 때만 쓴다)
export const BLOC_COLOR: Record<RegionId, string> = {
  A: '#6A98D8',
  B: '#D9798F',
  C: '#E9EDF0',
  D: '#C8B25C',
  E: '#8FD3E8',
  F: '#B596D6',
  R: '#74828F',
}

// 표 머리글용 짧은 이름
export const SHORT: Record<RegionId, string> = { A: '한국', B: '중국', C: '일본', D: '중동', E: '미국', F: '대만', R: '그 밖' }

// 지역을 고를 때 지도에서 고를 나라: 블록은 대표 나라, 나머지 세계는 그대로
export const pickIso = (r: RegionId, current: string) => (r === 'R' ? (regionOf(current) === 'R' ? current : 'DEU') : HOME[r])

// 조사: 받침이 있으면 첫째, 없으면 둘째 (이/가, 은/는, 을/를, 과/와)
export function josa(word: string, withFinal: string, without: string) {
  const ch = word.charCodeAt(word.length - 1)
  if (ch < 0xac00 || ch > 0xd7a3) return word + without
  return word + ((ch - 0xac00) % 28 ? withFinal : without)
}
export const rname = (r: RegionId) => (r === 'R' ? '나머지 세계' : regionName(r))
