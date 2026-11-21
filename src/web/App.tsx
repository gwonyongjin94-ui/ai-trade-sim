// 웹 지도 앱: 모드 네 개 (자료 · 관세 · 정책 실험 · AI 리플레이).
// 주소: #<나라>/<방향>/<품목>/<지표> (자료, 1단계와 같은 꼴) · #tariff/<나라>/... · #sim/<나라>/... · #replay/<나라>/...
// 고른 나라는 모드를 바꿔도 이어진다.

import { useEffect, useState } from 'react'
import { DATA } from './data'
import { DataMode } from './modes/DataMode'
import { ReplayMode } from './modes/ReplayMode'
import { SimMode } from './modes/SimMode'
import { TariffMode } from './modes/TariffMode'
import type { Mode } from './Screen'

type Route = { mode: Mode; iso: string; rest: string[] }

const PREFIX: Mode[] = ['tariff', 'sim', 'replay']

function readHash(): Route {
  const parts = decodeURIComponent(location.hash.slice(1)).split('/')
  const mode = PREFIX.includes(parts[0] as Mode) ? (parts.shift() as Mode) : 'data'
  const iso = parts[0] && DATA.countries[parts[0]] ? parts[0] : 'KOR'
  return { mode, iso, rest: parts.slice(1) }
}

function writeHash(r: Route) {
  const h = [...(r.mode === 'data' ? [] : [r.mode]), r.iso, ...r.rest].join('/').replace(/\/+$/, '')
  if (decodeURIComponent(location.hash.slice(1)) !== h) history.replaceState(null, '', `#${h}`)
}

export function App() {
  const [route, setRoute] = useState<Route>(readHash)

  useEffect(() => {
    const onHash = () => setRoute(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(() => writeHash(route), [route])

  const common = {
    iso: route.iso,
    rest: route.rest,
    setIso: (iso: string) => setRoute((r) => ({ ...r, iso })),
    setRest: (rest: string[]) => setRoute((r) => (r.rest.join('/') === rest.join('/') ? r : { ...r, rest })),
    onMode: (mode: Mode) => setRoute((r) => (r.mode === mode ? r : { mode, iso: r.iso, rest: [] })),
  }
  switch (route.mode) {
    case 'tariff':
      return <TariffMode key="tariff" {...common} />
    case 'sim':
      return <SimMode key="sim" {...common} />
    case 'replay':
      return <ReplayMode key="replay" {...common} />
    default:
      return <DataMode key="data" {...common} />
  }
}

export type ModeProps = {
  iso: string
  rest: string[]
  setIso: (iso: string) => void
  setRest: (rest: string[]) => void
  onMode: (m: Mode) => void
}
