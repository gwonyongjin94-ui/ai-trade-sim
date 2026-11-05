import type { RegionId } from './regions'

// 수출 통제 단계. 수출세 상당치로 엔진에 들어간다 (3은 전면 금지 = 그 상대 시장에서 이 나라 품종이 사라짐). v1과 같다.
export type ExportLevel = 0 | 1 | 2 | 3
export const EXPORT_LEVEL_LABEL = ['없음', '약한 통제', '강한 통제', '전면 금지'] as const
export const EXPORT_TAX_EQUIVALENT = [0, 0.25, 1.0, Infinity]

export const TARIFF_MAX = 2.0 // 200%
export const INVEST_MIN = 0.1
export const INVEST_MAX = 0.5 // v1은 35%. 중국의 2023년 투자율이 41%라 넓혔다

// 상대국별 정책. tariffs[상대][교역재]: 상대에게서 들여오는 물품에 매기는 관세율 (0.05 = 5%).
// exportControls[상대][교역재]: 상대에게 파는 물품의 수출 통제 단계. 자기 자신 칸은 쓰지 않는다 (0으로 둔다).
export interface Policy {
  tariffs: Record<RegionId, number[]>
  exportControls: Record<RegionId, ExportLevel[]>
  investmentRate: number // 지출 중 투자 비율
}

// 2023년 자료로 정한 지역 상수 (calibrate.ts)
export interface RegionCalibration {
  population: number
  labor: number
  gdpUsd: number // 2023년 명목 GDP (달러). 실질 GDP 지수 × 이 값을 "실질 GDP(2023년 달러)"로 보여 준다
  productivity: number[] // 부문별 (12)
  // beta[공급 지역][교역재]: 이 지역 구매자의 CES 가중치 (Armington). 2023년 가격·관세에서 실제 지출 비중이 나오도록 정했다
  beta: Record<RegionId, number[]>
  consumptionShare: number[] // 부문별 소비 바구니 기본 비중 (12, 합 1)
  investmentShare: number[] // 부문별 투자 바구니 기본 비중 (12, 합 1)
  deficit: number // 고정 이전: 지출 = 소득 + 적자 (모형 단위 = 2023년 USD 10억)
}

export interface RegionState {
  labor: number[] // 부문별 노동
  capital: number[] // 부문별 자본
}

export interface Base {
  // 수요 함수의 기준점과 측정 기준점. 보정한 시작점에서는 모든 가격이 1이다
  compositePrice: Record<RegionId, number[]>
  producerPrice: Record<RegionId, number[]>
  demandExpenditure: Record<RegionId, number> // 1인당 실질 소비지출
  perCapitaConsumption: Record<RegionId, number[]> // 소비 바구니에서 산 합성재 수량 ÷ 인구
  realConsumption: Record<RegionId, number> // 1인당
  realInvestment: Record<RegionId, number>
  realGdp: Record<RegionId, number>
  capital: Record<RegionId, number>
}

export interface World {
  quarter: number
  calib: Record<RegionId, RegionCalibration>
  state: Record<RegionId, RegionState>
  base: Base
  lastPrices: Record<RegionId, number[]>
  lastCpi: Record<RegionId, number>
}

export interface MarketResult {
  prices: Record<RegionId, number[]> // 생산자 가격 (12)
  compositePrice: Record<RegionId, number[]> // 구매자가 마주하는 합성재 가격 (12)
  output: Record<RegionId, number[]>
  labor: Record<RegionId, number[]>
  // purchases[구매][공급][교역재]: 수량 (생산자 가격 1 = 2023년 USD 10억어치)
  purchases: Record<RegionId, Record<RegionId, number[]>>
  consumptionQty: Record<RegionId, number[]> // 소비 바구니 합성재 수량
  investmentQty: Record<RegionId, number[]>
  spending: Record<RegionId, number[]> // 부문별 지출 (소비 + 투자)
  gdp: Record<RegionId, number> // 명목, 생산자 가격
  income: Record<RegionId, number> // GDP + 관세 수입 + 수출세 수입
  expenditure: Record<RegionId, number> // 소득 + 적자
  tariffRevenue: Record<RegionId, number>
  exportTaxRevenue: Record<RegionId, number>
  converged: boolean
  iterations: number
  maxExcess: number
}

export interface Indicators {
  livingStandard: number // 생활수준 지수 (시작=100): 1인당 실질소비 × (1 − 필수재 부족 페널티)
  welfare: number // 후생 지수 (시작=100): 생활수준을 반영한 소비 + 실질 투자
  realConsumption: number
  shortage: number
  shortageByGood: number[] // 교역재 순서
  realGdp: number // 실질 GDP 지수 (시작=100)
  realGdpUsd: number // 실질 GDP (2023년 달러) = 2023년 GDP × 지수 ÷ 100
  cpi: number
  inflation: number // 분기율
  importsValue: number // 국경 가격 (모형 단위)
  exportsValue: number
  importsFrom: Record<RegionId, number>
  exportsTo: Record<RegionId, number>
  tradeOpenness: number // (수출 + 수입) ÷ 명목 GDP (모형 단위끼리)
  tariffRevenueShare: number
  realInvestment: number
  capital: number // 자본 지수 (시작=100), 이번 분기 투자 반영
  importDependence: number[] // 교역재별 수입 비중 (지출 기준)
}

export interface QuarterResult {
  quarter: number
  market: MarketResult
  indicators: Record<RegionId, Indicators>
  policies: Record<RegionId, Policy>
}
