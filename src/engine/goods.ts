// 물품 정의. 20개 → 8개로 축소 (필수재 4 · 소비재 2 · 자본재 2, 원래 10:5:5 비율 유지).
//
// 탄력성 세 가지를 물품마다 따로 둔다.
//  - priceElasticity  (ε): 가격탄력성. 물품 전체(국산+수입 합성재)의 자기가격 탄력성
//  - incomeElasticity (η): 소득탄력성. 필수재 0~1, 소비재 >1. 소비재 묶음의 엥겔 합산 Σ s·η ≈ 1
//  - substitutionElasticity (σ): 국산품과 수입품 사이 대체탄력성 (Armington). 항상 1보다 크게 둔다
// 자본재는 탄력성이 아니라 기능으로 구분된다: 소비되지 않고 투자로 쓰여 다음 분기 생산능력(자본)을 늘린다.
//
// σ와 생산성은 Ossa(2014) 수준으로 보정한 값이다 (scripts/calibrate.ts, reports/calibration.md).
// 처음 설계값에서 σ' = 1 + 1.5·(σ − 1), 생산성 격차는 두 나라 기하평균 m 기준 A' = m·(A/m)^0.35 로 압축했다.
//
// 지출 비중은 문화 차이로 나라마다 다르다 (culture.ts). 두 나라 평균은 처음 설계값(곡물 14% …)과 거의 같고,
// A국은 가전·의약품·에너지 쪽으로, B국은 곡물·의류·생활용품 쪽으로 기운다.

export type Category = 'necessity' | 'consumer' | 'capital'
export type GoodId = 'grain' | 'energy' | 'medicine' | 'household' | 'appliances' | 'apparel' | 'machinery' | 'electronics'

export interface Good {
  id: GoodId
  name: string // 실제 물품명
  abstractName: string // 익명화 모드용 (WarAgent식 비교 실험)
  category: Category
  priceElasticity: number
  incomeElasticity: number // 자본재는 투자 예산에 비례하므로 1로 둔다 (계산에는 쓰이지 않음)
  substitutionElasticity: number
  baseShare: { A: number; B: number } // 소비재·필수재는 소비 예산 내 비중, 자본재는 투자 예산 내 비중. 나라별 취향 차이 (culture.ts)
  subsistence: number // 필수재 최저 소비선 (게임 시작 시 1인당 소비 대비 비율). 그 외 0
  productivity: { A: number; B: number } // 비교우위의 원천
  description: string
}

export const GOODS: Good[] = [
  {
    id: 'grain', name: '곡물', abstractName: '필수재 N1', category: 'necessity',
    priceElasticity: 0.25, incomeElasticity: 0.4, substitutionElasticity: 3.25,
    baseShare: { A: 0.11, B: 0.18 }, subsistence: 0.7, productivity: { A: 0.727, B: 0.983 },
    description: '주식. 가격이 올라도 소비를 크게 줄이기 어렵다.',
  },
  {
    id: 'energy', name: '에너지', abstractName: '필수재 N2', category: 'necessity',
    priceElasticity: 0.3, incomeElasticity: 0.7, substitutionElasticity: 8.5,
    baseShare: { A: 0.13, B: 0.11 }, subsistence: 0.6, productivity: { A: 0.438, B: 0.8 },
    description: '원산지 차이가 거의 없는 동질재라 국산·수입 대체는 쉽지만, 국내 생산능력이 없으면 대체할 물량이 없다.',
  },
  {
    id: 'medicine', name: '의약품', abstractName: '필수재 N3', category: 'necessity',
    priceElasticity: 0.3, incomeElasticity: 0.9, substitutionElasticity: 1.9,
    baseShare: { A: 0.12, B: 0.08 }, subsistence: 0.6, productivity: { A: 1.03, B: 0.874 },
    description: '제품별 차별성이 커서 국산·수입 대체가 어렵다.',
  },
  {
    id: 'household', name: '생활용품', abstractName: '필수재 N4', category: 'necessity',
    priceElasticity: 0.6, incomeElasticity: 0.8, substitutionElasticity: 4.0,
    baseShare: { A: 0.13, B: 0.15 }, subsistence: 0.5, productivity: { A: 1.0, B: 1.0 },
    description: '위생용품·세제 등. 필수재 중 상대적으로 탄력적이다.',
  },
  {
    id: 'appliances', name: '가전제품', abstractName: '소비재 C1', category: 'consumer',
    priceElasticity: 1.4, incomeElasticity: 1.4, substitutionElasticity: 4.0,
    baseShare: { A: 0.3, B: 0.22 }, subsistence: 0, productivity: { A: 1.091, B: 0.867 },
    description: '소득이 늘면 소비가 더 크게 는다. 가격에도 민감하다.',
  },
  {
    id: 'apparel', name: '의류·패션', abstractName: '소비재 C2', category: 'consumer',
    priceElasticity: 1.2, incomeElasticity: 1.25, substitutionElasticity: 4.75,
    baseShare: { A: 0.21, B: 0.26 }, subsistence: 0, productivity: { A: 0.9, B: 1.022 },
    description: '소득·가격 모두에 민감한 소비재.',
  },
  {
    id: 'machinery', name: '산업기계', abstractName: '자본재 K1', category: 'capital',
    priceElasticity: 0.8, incomeElasticity: 1, substitutionElasticity: 2.5,
    baseShare: { A: 0.55, B: 0.55 }, subsistence: 0, productivity: { A: 1.038, B: 0.814 },
    description: '투자에 쓰여 생산능력을 늘린다.',
  },
  {
    id: 'electronics', name: '전자부품', abstractName: '자본재 K2', category: 'capital',
    priceElasticity: 0.5, incomeElasticity: 1, substitutionElasticity: 1.75,
    baseShare: { A: 0.45, B: 0.45 }, subsistence: 0, productivity: { A: 1.014, B: 0.666 },
    description: '고기술 투자재. 국산·수입 대체가 매우 어려워 공급이 끊기면 투자 효율이 크게 떨어진다.',
  },
]

export const GOOD_IDS = GOODS.map((g) => g.id)
export const N_GOODS = GOODS.length
export const goodIndex = (id: GoodId) => GOOD_IDS.indexOf(id)

export const CATEGORY_LABEL: Record<Category, string> = {
  necessity: '필수재',
  consumer: '소비재',
  capital: '자본재',
}

export type Naming = 'real' | 'abstract'
export const goodName = (g: Good, naming: Naming) => (naming === 'real' ? g.name : g.abstractName)
