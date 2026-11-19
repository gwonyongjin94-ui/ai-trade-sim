// 지도 투영과 나라 모양. 밀러 투영을 태평양 가운데(동경 160도)로 돌려, 왼쪽에 중동, 가운데에 동아시아, 오른쪽에 북미가 오게 한다.

import { geoPath, geoProjection, type GeoProjection } from 'd3-geo'
import { feature } from 'topojson-client'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import type { Topology, GeometryCollection } from 'topojson-specification'
import world from 'world-atlas/countries-50m.json'

function millerRaw(lambda: number, phi: number): [number, number] {
  return [lambda, 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * phi))]
}
millerRaw.invert = (x: number, y: number): [number, number] => [x, 2.5 * Math.atan(Math.exp(0.8 * y)) - 0.625 * Math.PI]

const topo = world as unknown as Topology<{ countries: GeometryCollection<{ name: string }> }>
export const LAND: Feature<Geometry, { name: string }>[] = (
  feature(topo, topo.objects.countries) as FeatureCollection<Geometry, { name: string }>
).features.filter((f) => f.id !== '010') // 남극 제외

// 처음 화면에 꼭 들어와야 하는 범위: 지중해 동쪽(동경 24도)부터 북미 동쪽(서경 60도)까지
const FRAME = {
  type: 'MultiPoint' as const,
  coordinates: [[24, 0], [24, 60], [160, 0], [160, 60], [-60, 0], [-60, 60]],
}

export function makeProjection(width: number, height: number, padRight: number, padBottom: number): GeoProjection {
  const pad = 24
  return geoProjection(millerRaw)
    .rotate([-160, 0])
    .fitExtent(
      [[pad, pad + 40], [Math.max(pad + 100, width - padRight - pad), Math.max(pad + 140, height - padBottom - pad - 70)]],
      FRAME,
    )
}

export const pathFor = (p: GeoProjection) => geoPath(p)

// 배지를 놓을 자리 (경도, 위도). 나라 모양의 무게중심은 섬·속령 때문에 어긋나는 일이 많아 손으로 정했다
export const ANCHOR: Record<string, [number, number]> = {
  KOR: [127.9, 36.4], PRK: [127.0, 40.2], CHN: [104, 34.5], HKG: [114.2, 22.3], MAC: [113.5, 22.2],
  JPN: [138.5, 36.6], TWN: [121.0, 23.7],
  SAU: [44.5, 24], ARE: [54.2, 23.8], QAT: [51.2, 25.3], KWT: [47.6, 29.3], OMN: [57, 21], BHR: [50.55, 26.05],
  IRN: [54, 32.5], IRQ: [43.7, 33], ISR: [34.9, 31.3], JOR: [36.6, 31], LBN: [35.9, 33.9], SYR: [38.5, 35.1], YEM: [47.5, 15.6],
  USA: [-98, 39], CAN: [-106, 57], MEX: [-102, 23.5],
}

// 겹칠 때 누구를 먼저 보여 줄지 (작을수록 먼저). 고른 나라와 교역 상대는 이보다 앞선다
export const PRIORITY: Record<string, number> = {
  KOR: 0, CHN: 0, JPN: 0, USA: 0, TWN: 1, CAN: 1, MEX: 1, SAU: 1, IRN: 1,
  PRK: 2, HKG: 2, ARE: 2, IRQ: 2, ISR: 2,
  YEM: 3, OMN: 3, SYR: 3, QAT: 3, KWT: 3, JOR: 3, LBN: 3, MAC: 4, BHR: 4,
}
