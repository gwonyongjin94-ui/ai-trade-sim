// 원형 국기 배지에 쓰는 정사각형 국기 (country-flag-icons, MIT). build-world-map.ts가 public/flags/에 복사해 둔다.
// 국기 파일이 없는 곳(채널 제도 등)은 회색 원을 쓴다.

const BLANK = `data:image/svg+xml;charset=utf-8,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'><rect width='10' height='10' fill='#6B7A88'/></svg>")}`

export const flagUrl = (c: { iso2: string | null; flag: boolean }) =>
  c.flag && c.iso2 ? `${import.meta.env.BASE_URL}flags/${c.iso2}.svg` : BLANK
