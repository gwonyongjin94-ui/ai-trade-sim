// 두 나라의 문화 차이 (2026-11-03 가정). 문화는 세 경로로 들어간다.
//  1. 소비 취향: 물품별 기본 지출 비중이 나라마다 다르다 (goods.ts의 baseShare).
//     음식 취향은 오래 싸게 먹어온 현지 물품 쪽으로 형성된다 (Atkin 2013). 그래서 각자 잘 만드는 물품 쪽으로 기운다.
//  2. 노동 인구: 경제활동참가율이 다르다 (world.ts의 DEFAULT_PARAMS).
//     쟁기 농경 전통이 있는 사회는 성 역할 규범이 강하고 여성 경제활동 참가율이 낮다 (Alesina·Giuliano·Nunn 2013).
//  3. 대통령 프롬프트의 문화 설명: 경제 수치는 같고 행동에만 주는 처치라, 있음/없음을 실험 조건으로 비교한다.
//     차원은 Hofstede(개인주의, 권력거리, 불확실성 회피)와 Hall(저맥락·고맥락 소통)에서 가져왔다.
//     어느 쪽 문화도 협력적이거나 공격적이라고 쓰지 않는다 (GovSim식 중립).

import type { CountryId } from './types'

export type CultureBrief = 'shown' | 'hidden'

export const CULTURE_BRIEF_LABEL: Record<CultureBrief, string> = {
  shown: '문화 설명 있음',
  hidden: '문화 설명 없음',
}

export interface Culture {
  label: string
  participation: number // 경제활동참가율 (노동 인구 ÷ 인구)
  traits: string[] // 대통령 프롬프트용 설명
}

export const CULTURE: Record<CountryId, Culture> = {
  A: {
    label: '도시·산업 문화',
    participation: 0.55,
    traits: [
      '개인주의: 개인의 선택과 성취를 중시한다.',
      '권력거리가 낮다: 위계보다 평등한 관계를 중시한다.',
      '저맥락 소통: 뜻을 직설적으로 말하고, 합의는 문서에 적힌 문구대로 읽는다.',
      '불확실성 회피가 낮다: 새로운 방식과 변화를 비교적 쉽게 받아들인다.',
      '여성의 경제활동이 일반적이다.',
    ],
  },
  B: {
    label: '농경 전통 문화',
    participation: 0.45,
    traits: [
      '집단주의: 가족과 공동체의 안정과 조화를 중시한다.',
      '권력거리가 높다: 위계와 연장자·지도자의 권위를 존중한다.',
      '고맥락 소통: 뜻을 돌려 말하고, 관계와 체면을 문서의 문구만큼 중요하게 여긴다.',
      '불확실성 회피가 높다: 급격한 변화보다 예측 가능한 질서를 선호한다.',
      '전통적인 성 역할 규범이 강해 여성의 경제활동이 상대적으로 적다.',
    ],
  },
}
