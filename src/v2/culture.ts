// v2 문화 설명: Hofstede 6개 지표 (data/raw/hofstede/6-dimensions-for-website-2015-08-16.csv).
// 여러 나라를 묶은 블록은 자료가 있는 나라를 2023년 인구로 가중 평균했다 (2026-11-05 계산).
//   B: 중국·홍콩 (북한·마카오 자료 없음)
//   D: 아랍 국가들(ARA, 1억 8,360만 명)·이란(9,060만)·이스라엘(980만). 이스라엘은 쾌락 추구 값이 없다
//   E: 미국·캐나다·멕시코
// v1처럼 경제 수치는 같고 지도자 프롬프트에만 들어가는 처치라, 있음/없음을 실험 조건으로 비교한다.
// 정의는 Hofstede의 정의를 중립적으로 옮겼다. 어느 쪽 끝도 협력적이거나 공격적이라고 쓰지 않는다 (GovSim식 중립).

import type { BlocId } from './regions'

export type { CultureBrief } from '../engine/culture'
export { CULTURE_BRIEF_LABEL } from '../engine/culture'

export type HofstedeKey = 'pdi' | 'idv' | 'mas' | 'uai' | 'lto' | 'ivr'

export const HOFSTEDE_DIMENSIONS: { key: HofstedeKey; name: string; definition: string }[] = [
  { key: 'pdi', name: '권력거리', definition: '조직과 사회에서 권력이 고르지 않게 나뉘는 것을 구성원이 받아들이고 기대하는 정도' },
  { key: 'idv', name: '개인주의', definition: '높을수록 개인과 가까운 가족을 중심으로 느슨하게 맺어진 관계를, 낮을수록 평생 서로 돌보는 결속이 강한 집단을 선호한다' },
  { key: 'mas', name: '성취 지향', definition: '높을수록 성취·경쟁·눈에 보이는 성공을, 낮을수록 협의·삶의 질·약자에 대한 배려를 중시한다 (Hofstede의 남성성 지표)' },
  { key: 'uai', name: '불확실성 회피', definition: '불확실하거나 모호한 상황을 불편하게 여기고 규칙과 예측 가능성을 선호하는 정도' },
  { key: 'lto', name: '장기 지향', definition: '높을수록 미래를 위한 절약·끈기·적응을, 낮을수록 전통과 현재의 사회적 의무를 중시한다' },
  { key: 'ivr', name: '쾌락 추구', definition: '높을수록 삶을 즐기려는 욕구를 비교적 자유롭게 채우고, 낮을수록 엄격한 사회 규범으로 억제한다' },
]

export const HOFSTEDE: Record<BlocId, Record<HofstedeKey, number>> = {
  A: { pdi: 60, idv: 18, mas: 39, uai: 85, lto: 100, ivr: 29 },
  B: { pdi: 80, idv: 20, mas: 66, uai: 30, lto: 87, ivr: 24 },
  C: { pdi: 54, idv: 46, mas: 95, uai: 92, lto: 88, ivr: 42 },
  D: { pdi: 71, idv: 40, mas: 50, uai: 66, lto: 21, ivr: 36 },
  E: { pdi: 50, idv: 75, mas: 63, uai: 55, lto: 26, ivr: 75 },
  F: { pdi: 58, idv: 17, mas: 45, uai: 69, lto: 93, ivr: 49 },
}

// 실제 이름 조건에서만 밝힌다 (익명 조건에서 구성 나라를 쓰면 정체가 드러난다)
export const HOFSTEDE_NOTE: Partial<Record<BlocId, string>> = {
  B: '중국·홍콩 값의 인구 가중 평균 (북한·마카오 자료 없음)',
  D: '아랍 국가들·이란·이스라엘 값의 인구 가중 평균',
  E: '미국·캐나다·멕시코 값의 인구 가중 평균',
}
