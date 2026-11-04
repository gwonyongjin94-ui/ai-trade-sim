export type CountryId = 'A' | 'B'
export const COUNTRIES: CountryId[] = ['A', 'B']
export const rival = (c: CountryId): CountryId => (c === 'A' ? 'B' : 'A')

// 수출 통제 단계. 수출세 상당치로 엔진에 들어간다 (3은 전면 금지 = 해당 수입품이 상대국 시장에서 사라짐).
export type ExportLevel = 0 | 1 | 2 | 3
export const EXPORT_LEVEL_LABEL = ['없음', '약한 통제', '강한 통제', '전면 금지'] as const
export const EXPORT_TAX_EQUIVALENT = [0, 0.25, 1.0, Infinity]

export const TARIFF_MAX = 2.0 // 200%
export const INVEST_MIN = 0.1
export const INVEST_MAX = 0.35

export interface Policy {
  tariffs: number[] // 수입관세율 (0.05 = 5%), 물품 순서는 GOODS와 같다
  exportControls: ExportLevel[]
  investmentRate: number // 국민소득 중 투자 비율
}

export interface CountryParams {
  population: number
  labor: number // 노동 인구 = 인구 × 경제활동참가율 (culture.ts)
}

export interface CountryState {
  labor: number[] // 부문별 노동
  capital: number[] // 부문별 자본
}

export interface Base {
  // 수요 함수의 기준점 (warm-up 1단계 끝에서 고정)
  demandPrice: Record<CountryId, number[]>
  demandExpenditure: Record<CountryId, number>
  // 측정 기준점 (게임 시작 시점)
  producerPrice: Record<CountryId, number[]>
  compositePrice: Record<CountryId, number[]>
  perCapitaConsumption: Record<CountryId, number[]>
  realConsumption: Record<CountryId, number>
  realInvestment: Record<CountryId, number>
  realGdp: Record<CountryId, number>
  capital: Record<CountryId, number> // 전체 자본 스톡
}

export interface World {
  quarter: number // 게임 시작 = 0
  params: Record<CountryId, CountryParams>
  state: Record<CountryId, CountryState>
  base: Base
  lastPrices: Record<CountryId, number[]> // 다음 분기 균형 계산의 출발점
  lastCpi: Record<CountryId, number> // 직전 분기 소비자물가 지수 (물가 상승률 계산용, 게임 시작 = 100)
}

export interface MarketResult {
  prices: Record<CountryId, number[]> // 각국 생산품(variety)의 생산자 가격
  compositePrice: Record<CountryId, number[]> // 각국 구매자가 마주하는 합성재 가격
  output: Record<CountryId, number[]>
  labor: Record<CountryId, number[]> // 이번 분기에 실제로 쓴 노동 배치
  domesticQty: Record<CountryId, number[]> // 자국산 구매량
  importQty: Record<CountryId, number[]> // 수입량
  compositeQty: Record<CountryId, number[]> // 합성재 수량 (소비 또는 투자)
  spending: Record<CountryId, number[]>
  gdp: Record<CountryId, number> // 명목, 생산자 가격 기준
  income: Record<CountryId, number> // GDP + 관세 수입 + 수출세 수입
  tariffRevenue: Record<CountryId, number>
  exportTaxRevenue: Record<CountryId, number>
  consumptionBudget: Record<CountryId, number>
  investmentBudget: Record<CountryId, number>
  converged: boolean
  iterations: number
  maxExcess: number
}

export interface Indicators {
  livingStandard: number // 생활수준 지수 (시작=100): 실질소비 × (1 − 필수재 부족 페널티)
  welfare: number // 후생 지수 (시작=100): 생활수준을 반영한 소비 + 실질 투자. Ossa(2014)식 실질소득 비교용
  realConsumption: number // 1인당 실질소비 지수 (시작=100)
  shortage: number // 필수재 부족 지수 (0 = 부족 없음)
  shortageByGood: number[]
  realGdp: number // 실질 GDP 지수 (시작=100)
  cpi: number // 소비자물가 지수 (시작=100)
  inflation: number // 물가 상승률: 직전 분기 대비 소비자물가 변화율 (분기율. 연율은 annualRate)
  importsValue: number // 수입액 (명목)
  exportsValue: number
  tradeOpenness: number // (수출+수입)/GDP
  avgTariff: number // 단순 평균 관세율
  tariffRevenueShare: number // 관세 수입/소득
  realInvestment: number
  capital: number // 자본 지수 (시작=100): 이번 분기 투자까지 반영한 분기 말 전체 자본 스톡
  importDependence: number[] // 물품별 수입 의존도 (수입량 비중)
}

export interface QuarterResult {
  quarter: number
  market: MarketResult
  indicators: Record<CountryId, Indicators>
  policies: Record<CountryId, Policy>
}
