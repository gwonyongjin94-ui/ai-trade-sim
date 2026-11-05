// v2 부문 12개: 교역재 10개(HS 코드 묶음, docs/V2_DESIGN.md) + 교역되지 않는 서비스·건설.
//
// 탄력성은 v1 물품 정의(src/engine/goods.ts)를 이어받는다. σ는 v1에서 Ossa(2014) 수준으로 보정한 값을 대응하는 물품에 옮겼다:
//   식품←곡물, 에너지←에너지, 의약품←의약품, 의류·생활용품←생활용품·의류 평균, 전자←가전, 반도체←전자부품(고기술 투자재),
//   기계←산업기계. 새로 생긴 화학·자동차·금속은 비슷한 물품의 값을 썼다.
// 지출 비중·생산·교역은 탄력성이 아니라 2023년 자료에서 정한다 (src/v2/calibrate.ts).
// category는 설명과 확전점수용 구분이다. 실제로 어느 바구니(소비·투자)에 쓰이는지는 자료가 정한다.

export type Category = 'necessity' | 'consumer' | 'capital' | 'nontraded'

export interface Sector {
  id: string
  name: string
  abstractName: string // 익명 조건용
  category: Category
  traded: boolean
  priceElasticity: number // ε: 바구니 안에서 이 부문 합성재의 자기가격 탄력성
  incomeElasticity: number // η: 소비 바구니에서만 쓴다
  substitutionElasticity: number // σ: 공급처(나라) 사이 대체탄력성 (Armington). 교역되지 않는 부문은 쓰지 않음
  subsistence: number // 필수재 최저 소비선 (시작 1인당 소비 대비). 그 외 0
  description: string
}

export const SECTORS: Sector[] = [
  {
    id: 'food', name: '식품', abstractName: '필수재 N1', category: 'necessity', traded: true,
    priceElasticity: 0.25, incomeElasticity: 0.4, substitutionElasticity: 3.25, subsistence: 0.7,
    description: '농축수산물과 가공식품 (HS 01–24). 가격이 올라도 소비를 크게 줄이기 어렵다.',
  },
  {
    id: 'energy', name: '에너지', abstractName: '필수재 N2', category: 'necessity', traded: true,
    priceElasticity: 0.3, incomeElasticity: 0.7, substitutionElasticity: 8.5, subsistence: 0.6,
    description: '원유·가스·석탄·석유제품 (HS 27). 원산지 차이가 거의 없어 공급처를 바꾸기는 쉽지만, 세계 공급이 빠듯하면 값이 뛴다.',
  },
  {
    id: 'medicine', name: '의약품', abstractName: '필수재 N3', category: 'necessity', traded: true,
    priceElasticity: 0.3, incomeElasticity: 0.9, substitutionElasticity: 1.9, subsistence: 0.6,
    description: '의약품 (HS 30). 제품별 차별성이 커서 공급처를 바꾸기 어렵다.',
  },
  {
    id: 'apparel_household', name: '의류·생활용품', abstractName: '소비재 C1', category: 'consumer', traded: true,
    priceElasticity: 0.9, incomeElasticity: 1.0, substitutionElasticity: 4.4, subsistence: 0,
    description: '의류·신발·가죽·목재·종이·가구·완구 등 (HS 41–67, 93–97).',
  },
  {
    id: 'chemicals', name: '화학·플라스틱', abstractName: '소비재 C2', category: 'consumer', traded: true,
    priceElasticity: 0.6, incomeElasticity: 0.9, substitutionElasticity: 4.0, subsistence: 0,
    description: '화학제품·비료·화장품·플라스틱·고무 (HS 28–29, 31–40).',
  },
  {
    id: 'vehicles', name: '자동차·운송장비', abstractName: '소비재 C3', category: 'consumer', traded: true,
    priceElasticity: 1.3, incomeElasticity: 1.4, substitutionElasticity: 4.0, subsistence: 0,
    description: '자동차·부품·선박·항공기·철도 (HS 86–89). 소득이 늘면 소비가 더 크게 는다.',
  },
  {
    id: 'metals', name: '금속·광물', abstractName: '자본재 K1', category: 'capital', traded: true,
    priceElasticity: 0.6, incomeElasticity: 1, substitutionElasticity: 4.0, subsistence: 0,
    description: '광석·철강·비철금속·금속제품·유리·시멘트 (HS 25–26, 68–83). 건설과 설비 투자에 쓰인다.',
  },
  {
    id: 'machinery', name: '기계', abstractName: '자본재 K2', category: 'capital', traded: true,
    priceElasticity: 0.8, incomeElasticity: 1, substitutionElasticity: 2.5, subsistence: 0,
    description: '산업기계·컴퓨터·반도체 장비 (HS 84). 투자에 쓰여 생산능력을 늘린다.',
  },
  {
    id: 'semiconductors', name: '반도체', abstractName: '자본재 K3', category: 'capital', traded: true,
    priceElasticity: 0.5, incomeElasticity: 1, substitutionElasticity: 1.75, subsistence: 0,
    description: '집적회로 (HS 8542). 고기술 투자재라 공급처를 바꾸기 매우 어렵고, 끊기면 투자 효율이 크게 떨어진다.',
  },
  {
    id: 'electronics', name: '전자·정밀기기', abstractName: '소비재 C4', category: 'consumer', traded: true,
    priceElasticity: 1.4, incomeElasticity: 1.4, substitutionElasticity: 4.0, subsistence: 0,
    description: '전기·전자기기(반도체 제외)·광학·정밀기기 (HS 85, 90–92). 소득과 가격 모두에 민감하다.',
  },
  {
    id: 'services', name: '서비스', abstractName: '서비스', category: 'nontraded', traded: false,
    priceElasticity: 0.6, incomeElasticity: 1.1, substitutionElasticity: 0, subsistence: 0,
    description: '유통·금융·의료·교육·공공 등. 교역되지 않는다.',
  },
  {
    id: 'construction', name: '건설', abstractName: '건설', category: 'nontraded', traded: false,
    priceElasticity: 0.5, incomeElasticity: 1, substitutionElasticity: 0, subsistence: 0,
    description: '건물·설비 공사. 투자에 쓰이고 교역되지 않는다.',
  },
]

export const N_SECTORS = SECTORS.length
export const SECTOR_IDS = SECTORS.map((s) => s.id)
export const sectorIndex = (id: string) => {
  const i = SECTOR_IDS.indexOf(id)
  if (i < 0) throw new Error(`알 수 없는 부문: ${id}`)
  return i
}
// 교역재는 SECTORS 앞쪽 10개다. 관세·수출 통제 배열은 이 순서를 따른다
export const TRADED = SECTORS.filter((s) => s.traded)
export const N_TRADED = TRADED.length
export const NECESSITIES = SECTORS.map((s, i) => (s.category === 'necessity' ? i : -1)).filter((i) => i >= 0)

export type SectorNaming = 'real' | 'abstract'
export const sectorName = (s: Sector, naming: SectorNaming) => (naming === 'real' ? s.name : s.abstractName)
