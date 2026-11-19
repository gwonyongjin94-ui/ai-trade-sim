// 지도 투영과 나라 모양. 밀러 투영을 두 가지로 돌려 쓴다.
//   태평양 가운데(동경 150도): 왼쪽 유럽·아프리카, 가운데 아시아, 오른쪽 아메리카. 아시아·오세아니아·북미를 고르면 이 지도
//   대서양 가운데(동경 10도): 왼쪽 아메리카, 가운데 유럽·아프리카, 오른쪽 아시아. 남미·유럽·아프리카·중동을 고르면 이 지도
// 고른 나라의 교역선이 지도 끝을 넘어가지 않게 하려는 것이다.

import { geoArea, geoCentroid, geoPath, geoProjection, type GeoProjection } from 'd3-geo'
import { feature } from 'topojson-client'
import type { Feature, FeatureCollection, Geometry, MultiPolygon, Polygon } from 'geojson'
import type { Topology, GeometryCollection } from 'topojson-specification'
import world from 'world-atlas/countries-50m.json'
import { COUNTRIES } from './data'

function millerRaw(lambda: number, phi: number): [number, number] {
  return [lambda, 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * phi))]
}
millerRaw.invert = (x: number, y: number): [number, number] => [x, 2.5 * Math.atan(Math.exp(0.8 * y)) - 0.625 * Math.PI]

const topo = world as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>
export const LAND: Feature<Geometry, { name: string }>[] = (
  feature(topo, topo.objects.countries) as FeatureCollection<Geometry, { name: string }>
).features
  .filter((f) => f.id !== '010') // 남극 제외
  .map((f) => (f.properties.name === 'Kosovo' && !f.id ? { ...f, id: 'XKX' } : f)) // 코소보는 숫자 코드가 없다

export type ViewId = 'pacific' | 'atlantic'
const CENTER: Record<ViewId, number> = { pacific: 150, atlantic: 10 }

// 처음 화면에 들어와야 하는 범위: 경도는 한 바퀴 전부, 위도는 남위 50도 ~ 북위 74도
function frame(view: ViewId) {
  const c = CENTER[view]
  return {
    type: 'MultiPoint' as const,
    coordinates: [[c - 179.5, 74], [c + 179.5, 74], [c - 179.5, -50], [c + 179.5, -50], [c, 74], [c, -50]],
  }
}

export function makeProjection(view: ViewId, width: number, height: number, padRight: number, padBottom: number): GeoProjection {
  const pad = 16
  return geoProjection(millerRaw)
    .rotate([-CENTER[view], 0])
    .fitExtent(
      [[pad, pad + 40], [Math.max(pad + 100, width - padRight - pad), Math.max(pad + 140, height - padBottom - pad - 60)]],
      frame(view),
    )
}

export const pathFor = (p: GeoProjection) => geoPath(p)

// 배지를 놓을 자리 (경도, 위도). 기본은 나라에서 가장 큰 땅덩어리의 무게중심이고,
// 그 점이 어색한 나라(속령·섬이 멀리 있거나 모양이 휜 곳)는 손으로 정했다
const MANUAL: Record<string, [number, number]> = {
  KOR: [127.9, 36.4], PRK: [127.0, 40.2], CHN: [104, 34.5], HKG: [114.2, 22.3], MAC: [113.5, 22.2],
  JPN: [138.5, 36.6], TWN: [121.0, 23.7],
  SAU: [44.5, 24], ARE: [54.2, 23.8], QAT: [51.2, 25.3], KWT: [47.6, 29.3], OMN: [57, 21], BHR: [50.55, 26.05],
  IRN: [54, 32.5], IRQ: [43.7, 33], ISR: [34.9, 31.3], JOR: [36.6, 31], LBN: [35.9, 33.9], SYR: [38.5, 35.1], YEM: [47.5, 15.6],
  USA: [-98, 39], CAN: [-106, 57], MEX: [-102, 23.5],
  RUS: [96, 62], NOR: [9.5, 61.5], FRA: [2.5, 46.6], GBR: [-1.8, 52.8], DNK: [9.2, 56], NLD: [5.6, 52.2], ITA: [12.6, 42.8],
  ESP: [-3.6, 40.2], PRT: [-8.1, 39.6], GRC: [22, 39.4], CHL: [-71, -33], ARG: [-64.5, -35], IDN: [113.5, -1.5],
  MYS: [102.2, 4], PHL: [122, 12.5], VNM: [106, 16], NZL: [172.5, -42], AUS: [134, -25], CHE: [8.2, 46.8], SGP: [103.8, 1.35],
  HRV: [16.2, 45.3], ECU: [-78.4, -1.5], ZAF: [24.5, -29.5], CRI: [-84.2, 10], PAN: [-80.3, 8.6],
}

export const MAP_FEATURE = new Map(LAND.map((f) => [String(f.id), f]))

function largestPartCentroid(f: Feature<Geometry>): [number, number] {
  const g = f.geometry
  if (g.type !== 'MultiPolygon') return geoCentroid(f)
  let best: Polygon | null = null
  let bestArea = -1
  for (const coords of (g as MultiPolygon).coordinates) {
    const p: Polygon = { type: 'Polygon', coordinates: coords }
    const a = geoArea(p)
    if (a > bestArea) { bestArea = a; best = p }
  }
  return geoCentroid(best!)
}

export const ANCHOR: Record<string, [number, number]> = {}
for (const c of COUNTRIES) {
  if (MANUAL[c.iso]) { ANCHOR[c.iso] = MANUAL[c.iso]; continue }
  const f = c.mapId ? MAP_FEATURE.get(c.mapId) : undefined
  if (f) ANCHOR[c.iso] = largestPartCentroid(f)
}

// 고른 나라가 어느 지도에서 가운데 쪽에 오는가. 서경 90도 ~ 동경 60도 사이(남미·유럽·아프리카·중동)는 대서양 지도
export function viewFor(iso: string): ViewId {
  const a = ANCHOR[iso]
  if (!a) return 'pacific'
  return a[0] > -90 && a[0] < 60 ? 'atlantic' : 'pacific'
}
