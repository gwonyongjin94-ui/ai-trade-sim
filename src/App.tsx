import { useState } from 'react'
import { GameView } from './ui/GameView'
import { Setup } from './ui/Setup'
import type { SetupState } from './ui/session'
import { createSession } from './ui/session'
import type { Session } from './ui/session'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const start = (s: SetupState) => setSession(createSession(s))
  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      <header className="mb-5 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-bold">AI 무역 시뮬레이션</h1>
        <p className="text-sm text-slate-500">두 나라 · 교역만 가능 · 전쟁 없음 · 대통령 4년 단임 · 현실 10분 = 가상 1년</p>
      </header>
      {session ? (
        <GameView
          key={session.id}
          session={session}
          onExit={() => {
            session.game.stop()
            setSession(null)
          }}
        />
      ) : (
        <Setup onStart={start} />
      )}
    </div>
  )
}
