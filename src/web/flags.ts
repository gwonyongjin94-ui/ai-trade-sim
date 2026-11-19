// 원형 국기 배지에 쓰는 정사각형 국기 (country-flag-icons, MIT)

import { AE, BH, CA, CN, HK, IL, IQ, IR, JO, JP, KP, KR, KW, LB, MO, MX, OM, QA, SA, SY, TW, US, YE } from 'country-flag-icons/string/1x1'

const SVG: Record<string, string> = { AE, BH, CA, CN, HK, IL, IQ, IR, JO, JP, KP, KR, KW, LB, MO, MX, OM, QA, SA, SY, TW, US, YE }

export const flagUrl = (iso2: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(SVG[iso2] ?? '')}`
