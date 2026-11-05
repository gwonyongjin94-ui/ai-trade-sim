// v2 지역: AI 지도자가 이끄는 블록 6개 + 정책이 고정된 나머지 세계 (docs/V2_DESIGN.md).
// 나라 이름 조건(실제 이름 / A~F)은 지도자에게 보여 줄 때만 갈린다. 경제 자료는 둘 다 실제 값이다.

export type BlocId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F'
export type RegionId = BlocId | 'R'

export const BLOCS: BlocId[] = ['A', 'B', 'C', 'D', 'E', 'F']
export const REGIONS: RegionId[] = [...BLOCS, 'R']
export const N_REGIONS = REGIONS.length
export const regionIndex = (r: RegionId) => REGIONS.indexOf(r)
export const isBloc = (r: RegionId): r is BlocId => r !== 'R'

export type RegionNaming = 'real' | 'abstract'

export const REGION_NAME: Record<RegionId, { real: string; abstract: string; members: string }> = {
  A: { real: '대한민국', abstract: 'A국', members: '대한민국' },
  B: { real: '중국', abstract: 'B국', members: '중국, 북한, 홍콩, 마카오' },
  C: { real: '일본', abstract: 'C국', members: '일본' },
  D: { real: '중동', abstract: 'D국', members: '사우디아라비아, 아랍에미리트, 카타르, 쿠웨이트, 오만, 바레인, 이란, 이라크, 이스라엘, 요르단, 레바논, 시리아, 예멘' },
  E: { real: '미국', abstract: 'E국', members: '미국, 캐나다, 멕시코' },
  F: { real: '대만', abstract: 'F국', members: '대만' },
  R: { real: '나머지 세계', abstract: '나머지 세계', members: '그 밖의 모든 나라 (유럽연합, 인도, 동남아시아, 러시아, 남미, 아프리카 등)' },
}

export const regionName = (r: RegionId, naming: RegionNaming) => REGION_NAME[r][naming]

export const perRegion = <T>(f: (r: RegionId) => T): Record<RegionId, T> =>
  Object.fromEntries(REGIONS.map((r) => [r, f(r)])) as Record<RegionId, T>
