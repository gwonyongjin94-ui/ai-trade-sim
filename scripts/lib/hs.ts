// 물품 10개 (HS 2단위, 반도체만 HS 4단위)와 HS 장 → 물품 대응. fetch-v2-data.ts와 build-map-data.ts가 같이 쓴다

export const GOODS_V2 = [
  'food', 'energy', 'medicine', 'apparel_household', 'chemicals', 'vehicles', 'metals', 'machinery', 'semiconductors', 'electronics',
] as const
export type GoodV2 = (typeof GOODS_V2)[number]
export function goodOfChapter(ch: number): GoodV2 {
  if (ch <= 24) return 'food'
  if (ch === 27) return 'energy'
  if (ch === 30) return 'medicine'
  if (ch >= 28 && ch <= 40) return 'chemicals'
  if (ch >= 86 && ch <= 89) return 'vehicles'
  if ((ch >= 72 && ch <= 83) || [25, 26, 68, 69, 70, 71].includes(ch)) return 'metals'
  if (ch === 84) return 'machinery'
  if (ch === 85 || (ch >= 90 && ch <= 92)) return 'electronics' // 반도체(8542)는 따로 빼 낸다
  return 'apparel_household' // 41–67, 93–97, 99
}
