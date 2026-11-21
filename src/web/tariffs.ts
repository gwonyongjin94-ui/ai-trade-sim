// 2023년 시작 관세 (엔진이 쓰는 값 그대로, src/data/v2-base-2023.json). 지역 단위: 블록 6개 + 나머지 세계.
// 출처: World Bank WITS TradeStats-Tariff, 적용 관세(AHS) 수입액 가중 평균 2022년 + 미중 무역전쟁 추가 관세(PIIE),
// 대만은 WITS TRAINS 최혜국 세율, 나머지 세계가 매기는 관세는 EU 관세로 대신 (scripts/fetch-v2-tariffs.ts).

import { BASE } from '../v2/calibrate'
import { REGIONS, type RegionId } from '../v2/regions'
import { GOODS } from './data'

// importer가 exporter산 good에 매기는 관세 (%). 자기 자신은 null
export function tariffPct(importer: RegionId, exporter: RegionId, good: string): number | null {
  if (importer === exporter) return null
  return Math.round(BASE.tariffs[importer][exporter][good] * 1000) / 10
}

// 2023년 수입액 (10억 달러, 국경 가격)
export const flowB = (exporter: RegionId, importer: RegionId, good: string) => (exporter === importer ? 0 : BASE.flows[exporter][importer][good] ?? 0)

// 10개 품목 평균. 2023년 수입액으로 가중한다 (WITS AHS 가중 평균과 같은 방식). 수입이 없으면 단순 평균
export function avgTariffPct(importer: RegionId, exporter: RegionId): number | null {
  if (importer === exporter) return null
  let w = 0
  let s = 0
  for (const g of GOODS) {
    const f = flowB(exporter, importer, g.id)
    w += f
    s += f * tariffPct(importer, exporter, g.id)!
  }
  if (w > 0) return s / w
  return GOODS.reduce((a, g) => a + tariffPct(importer, exporter, g.id)!, 0) / GOODS.length
}

export const tariffOf = (importer: RegionId, exporter: RegionId, good: string | null) =>
  good ? tariffPct(importer, exporter, good) : avgTariffPct(importer, exporter)

export const EXPORT_CONTROLS = BASE.exportControls // [{from, to, good, level}]

export const CONTROL_REASON: Record<string, string> = {
  'E>B>semiconductors': '2022·2023년 미국의 첨단 반도체 대중국 수출 통제. 반도체 전체가 아니라 첨단 칩 일부만 대상이라 1단계(약한 통제)로 둔다',
}

export const TARIFF_NOTES = [
  '적용 관세(AHS)는 FTA 특혜세율을 반영한 실제 적용 세율이다. 2022년 값 (없으면 2021·2020·2023년).',
  '미국의 대중국 관세는 301조 추가 관세를 더해 평균 19.3%, 중국의 대미국 관세는 보복 관세를 더해 평균 21%로 맞췄다 (PIIE, Bown).',
  'WITS는 기계·반도체·전자(HS 84–85)를 나누지 않는다. 반도체는 정보기술협정(ITA)으로 대부분 무관세라 0%로 둔다.',
  '대만은 WITS 통계에 없어서 대만의 관세는 TRAINS 최혜국 세율, 대만에 매기는 관세는 수입국의 최혜국 세율로 대신했다.',
  '블록 사이 관세는 회원국 쌍의 값을 물품별 수입액으로 가중했다. 블록이 나머지 세계에 매기는 관세는 회원국의 대세계 관세 평균, 나머지 세계가 매기는 관세는 EU 관세로 대신한다.',
  '미국 232조(철강·알루미늄) 같은 다른 추가 관세는 넣지 않았다.',
]

export const REGION_LIST = REGIONS
