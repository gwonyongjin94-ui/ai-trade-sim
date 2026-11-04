import { useEffect, useState } from 'react'
import { describeTerm, TONE_LABEL } from '../engine/diplomacy'
import { CATEGORY_LABEL, GOODS, goodName } from '../engine/goods'
import type { GoodId, Naming } from '../engine/goods'
import { OBJECTIVE_LABEL } from '../engine/objectives'
import { COUNTRIES } from '../engine/types'
import type { CountryId } from '../engine/types'
import type { GameEvent } from '../sim/types'
import { LineChart } from './Chart'
import type { Series } from './Chart'
import { HumanPanel } from './HumanPanel'
import { controllerLabel } from './session'
import type { Session } from './session'

const COLOR: Record<CountryId, string> = { A: '#2563eb', B: '#ea580c' }
const PHASE_LABEL: Record<string, string> = {
  idle: '준비',
  diplomacy: '외교 1라운드',
  decision: '외교 2라운드 · 정책 결정',
  resolving: '계산 중',
  waiting: '분기 진행 중',
  done: '종료',
}

function useGameTick(session: Session) {
  const [, setTick] = useState(0)
  useEffect(() => {
    const off = session.game.onEvent(() => setTick((t) => t + 1))
    const timer = setInterval(() => setTick((t) => t + 1), 500)
    if (session.game.phase === 'idle') void session.game.run()
    return () => {
      off()
      clearInterval(timer)
    }
  }, [session])
}

export function GameView({ session, onExit }: { session: Session; onExit: () => void }) {
  useGameTick(session)
  const { game, setup, humans, references } = session
  const [saved, setSaved] = useState<string | null>(null)
  const [showMinds, setShowMinds] = useState(false)
  const recs = game.records
  const q = game.quarter
  const done = game.phase === 'done'
  const hasHuman = Object.keys(humans).length > 0
  const mindsAllowed = !hasHuman || done
  const naming = setup.naming
  const T = game.termQuarters
  const total = game.totalQuarters
  const remaining = game.phaseDeadline ? Math.max(0, Math.ceil((game.phaseDeadline - Date.now()) / 1000)) : null

  const series = (get: (c: CountryId, i: number) => number, ref?: (c: CountryId) => { free?: number[]; nash?: number[] }): Series[] =>
    COUNTRIES.flatMap((c) => {
      const out: Series[] = [{ label: `${c}국`, color: COLOR[c], values: recs.map((_, i) => get(c, i)), width: 2.5 }]
      const r = ref?.(c)
      if (r?.free) out.push({ label: `${c} 자유무역`, color: COLOR[c], values: r.free, dash: '5 4', width: 1.2 })
      if (r?.nash) out.push({ label: `${c} 내시`, color: COLOR[c], values: r.nash, dash: '1 3', width: 1.5 })
      return out
    })

  const termScores = game.events.filter((e): e is Extract<GameEvent, { type: 'term' }> => e.type === 'term')

  const save = async () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const names = COUNTRIES.map((c) => controllerLabel(setup[c].controller).replace(/\s/g, '')).join('-vs-')
    const res = await fetch('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: `${stamp}-${names}`, jsonl: game.events.map((e) => JSON.stringify(e)).join('\n') + '\n' }),
    })
    const body = (await res.json()) as { ok: boolean; file?: string; error?: string }
    setSaved(body.ok ? `저장됨: ${body.file}` : `저장 실패: ${body.error}`)
  }

  return (
    <div className="space-y-4">
      <section className="card flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <div className="text-lg font-bold tabular-nums">
          {done ? '게임 종료' : `${Math.floor(q / 4) + 1}년차 ${(q % 4) + 1}분기`}
          <span className="ml-2 text-sm font-normal text-slate-500">
            ({Math.min(q + 1, total)}/{total}분기 · {game.presidentNumber(Math.min(q, total - 1))}대 대통령)
          </span>
        </div>
        <div>
          {PHASE_LABEL[game.phase]}
          {remaining !== null && !done && <span className="ml-2 tabular-nums text-slate-500">남은 시간 {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</span>}
        </div>
        {COUNTRIES.map((c) => (
          <div key={c}>
            <span className="font-semibold" style={{ color: COLOR[c] }}>
              {c}국
            </span>{' '}
            {controllerLabel(setup[c].controller)} · {OBJECTIVE_LABEL[setup[c].objective]}
          </div>
        ))}
        <div className="ml-auto flex gap-2">
          {done && (
            <button className="btn-ghost" onClick={save}>
              로그 저장
            </button>
          )}
          <button className="btn-ghost" onClick={onExit}>
            {done ? '처음으로' : '그만두기'}
          </button>
        </div>
        {saved && <div className="w-full text-xs text-slate-500">{saved}</div>}
      </section>

      {COUNTRIES.filter((c) => humans[c]).map((c) => (
        <HumanPanel key={c} country={c} leader={humans[c]!} naming={naming} />
      ))}

      <div className="grid gap-4 md:grid-cols-2">
        <LineChart
          title="생활수준 지수"
          quarters={total}
          termQuarters={T}
          series={series((c, i) => recs[i].indicators[c].livingStandard, (c) => ({ free: references.freeTrade[c].livingStandard, nash: references.nash?.[c].livingStandard }))}
          note="점선: 자유무역을 계속했을 때 · 점: 동적 내시 관세를 계속했을 때 (이론 기준선)"
        />
        <LineChart
          title="실질 GDP 지수"
          quarters={total}
          termQuarters={T}
          series={series((c, i) => recs[i].indicators[c].realGdp, (c) => ({ free: references.freeTrade[c].realGdp, nash: references.nash?.[c].realGdp }))}
        />
        <LineChart
          title="물가 상승률 (전 분기 대비)"
          quarters={total}
          termQuarters={T}
          fmt={(x) => `${(x * 100).toFixed(1)}%`}
          series={series((c, i) => recs[i].indicators[c].inflation)}
          note="소비자물가 지수의 분기 변화율. 관세 인상·수출 통제로 수입품이 비싸지면 오른다"
        />
        <LineChart
          title="평균 관세"
          quarters={total}
          termQuarters={T}
          fmt={(x) => `${(x * 100).toFixed(0)}%`}
          series={series((c, i) => recs[i].indicators[c].avgTariff, (c) => ({ nash: references.nash?.[c].avgTariff }))}
        />
        <LineChart title="누적 확전점수 (Rivera 방식)" quarters={total} termQuarters={T} series={series((c, i) => recs[i].cumulativeEs[c])} note="관세 인상·수출 통제·위협·약속 위반은 +, 완화·제안 수락은 −" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[3fr_2fr]">
        <PolicyTable session={session} />
        <DiplomacyLog session={session} showMinds={showMinds && mindsAllowed} />
      </div>

      <section className="card text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-semibold">임기별 목표 점수</h3>
          <label className="ml-auto flex items-center gap-2 text-xs">
            <input type="checkbox" disabled={!mindsAllowed} checked={showMinds && mindsAllowed} onChange={(e) => setShowMinds(e.target.checked)} />
            AI의 비공개 판단 보기 {mindsAllowed ? '' : '(사람이 플레이 중에는 게임이 끝난 뒤 공개)'}
          </label>
        </div>
        {termScores.length === 0 ? (
          <p className="text-slate-500">첫 임기가 끝나면 나옵니다.</p>
        ) : (
          <table className="mt-2 text-sm">
            <tbody>
              {termScores.map((t, i) => (
                <tr key={i}>
                  <td className="pr-4" style={{ color: COLOR[t.country] }}>
                    {t.country}국 {t.president}대
                  </td>
                  <td className="pr-4">
                    {t.fromQuarter + 1}~{t.toQuarter + 1}분기
                  </td>
                  <td className="pr-4">{OBJECTIVE_LABEL[t.objective]}</td>
                  <td className="tabular-nums font-semibold">{t.score.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

function PolicyTable({ session }: { session: Session }) {
  const { game, setup } = session
  const last = game.results[game.results.length - 1]
  return (
    <section className="card overflow-x-auto">
      <h3 className="mb-2 font-semibold">물품별 정책 (현재)</h3>
      <table className="w-full text-sm">
        <thead className="text-left text-xs text-slate-500">
          <tr>
            <th className="py-1">물품</th>
            <th>분류</th>
            {COUNTRIES.map((c) => (
              <th key={c} colSpan={3} style={{ color: COLOR[c] }}>
                {c}국 관세 · 통제 · 수입의존
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {GOODS.map((g, i) => (
            <tr key={g.id} className="border-t border-slate-100 tabular-nums dark:border-slate-800">
              <td className="py-1">{goodName(g, setup.naming)}</td>
              <td className="text-xs text-slate-500">{CATEGORY_LABEL[g.category]}</td>
              {COUNTRIES.map((c) => {
                const ctl = game.policies[c].exportControls[i]
                return [
                  <td key={`${c}t`}>{(game.policies[c].tariffs[i] * 100).toFixed(0)}%</td>,
                  <td key={`${c}x`} className={ctl ? 'font-semibold text-red-600' : 'text-slate-400'}>
                    {ctl}
                  </td>,
                  <td key={`${c}d`} className="text-slate-500">
                    {last ? `${(last.indicators[c].importDependence[i] * 100).toFixed(0)}%` : '-'}
                  </td>,
                ]
              })}
            </tr>
          ))}
          <tr className="border-t border-slate-200 dark:border-slate-700">
            <td className="py-1">투자율</td>
            <td />
            {COUNTRIES.map((c) => (
              <td key={c} colSpan={3} className="tabular-nums">
                {(game.policies[c].investmentRate * 100).toFixed(0)}%
                {last && <span className="ml-2 text-xs text-slate-500">필수재 부족 {last.indicators[c].shortage.toFixed(2)}</span>}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </section>
  )
}

function DiplomacyLog({ session, showMinds }: { session: Session; showMinds: boolean }) {
  const { game } = session
  const items = [...game.events].reverse().slice(0, 200)
  return (
    <section className="card max-h-[560px] overflow-y-auto text-sm">
      <h3 className="mb-2 font-semibold">외교·사건 기록</h3>
      <ul className="space-y-2">
        {items.map((e, i) => (
          <LogItem key={game.events.length - i} e={e} showMinds={showMinds} naming={session.setup.naming} />
        ))}
      </ul>
    </section>
  )
}

function LogItem({ e, showMinds, naming }: { e: GameEvent; showMinds: boolean; naming: Naming }) {
  const name = (id: GoodId) => goodName(GOODS.find((g) => g.id === id)!, naming)
  const qLabel = (q: number) => <span className="text-xs text-slate-400">{q + 1}분기</span>
  switch (e.type) {
    case 'diplomacy':
      if (!e.action.message && e.proposals.length === 0 && !(showMinds && e.action.thinking)) return null
      return (
        <li>
          {qLabel(e.quarter)} <b style={{ color: COLOR[e.country] }}>{e.country}국</b> <span className="text-xs text-slate-500">1라운드 · {TONE_LABEL[e.action.tone]}</span>
          {e.action.message && <div>{e.action.message}</div>}
          {e.proposals.map((p) => (
            <div key={p.id} className="text-xs text-slate-600 dark:text-slate-400">
              제안 [{p.id}] {p.terms.map((t) => describeTerm(t, p.from, name)).join(' / ')} · {p.durationQuarters}분기
            </div>
          ))}
          {showMinds && e.action.thinking && <div className="mt-1 rounded bg-slate-100 p-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">생각: {e.action.thinking}</div>}
        </li>
      )
    case 'decision':
      if (!e.action.message && e.accepted.length === 0 && !e.meta?.error && !(showMinds && e.action.reasoning)) return null
      return (
        <li>
          {qLabel(e.quarter)} <b style={{ color: COLOR[e.country] }}>{e.country}국</b> <span className="text-xs text-slate-500">2라운드 · {TONE_LABEL[e.action.tone]}</span>
          {e.action.message && <div>{e.action.message}</div>}
          {e.accepted.length > 0 && <div className="text-xs text-emerald-600">수락: {e.accepted.join(', ')}</div>}
          {showMinds && e.action.reasoning && <div className="mt-1 rounded bg-slate-100 p-1 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">판단: {e.action.reasoning}</div>}
          {showMinds && e.action.handoverMemo && <div className="mt-1 rounded bg-amber-50 p-1 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">인수인계: {e.action.handoverMemo}</div>}
          {e.meta?.error && <div className="text-xs text-red-600">오류: {e.meta.error}</div>}
        </li>
      )
    case 'quarter':
      return e.violations.filter((v) => v.first).length || Math.max(e.es.A.score, e.es.B.score) >= 12 ? (
        <li className="text-xs text-slate-500">
          {qLabel(e.quarter)} 확전점수 A {e.es.A.score >= 0 ? '+' : ''}
          {e.es.A.score} · B {e.es.B.score >= 0 ? '+' : ''}
          {e.es.B.score}
          {e.violations
            .filter((v) => v.first)
            .map((v) => (
              <div key={v.commitmentId} className="text-red-600">
                약속 위반 {v.obligor}국 [{v.commitmentId}] {v.detail}
              </div>
            ))}
        </li>
      ) : null
    case 'anomaly':
      if (['clamped_output', 'words_vs_actions', 'promise_broken'].includes(e.kind)) return null
      return (
        <li className="text-xs text-amber-700 dark:text-amber-400">
          {qLabel(e.quarter)} ⚑ {e.country ? `${e.country}국 ` : ''}
          {e.detail}
        </li>
      )
    case 'term':
      return (
        <li className="text-xs font-semibold" style={{ color: COLOR[e.country] }}>
          {e.country}국 {e.president}대 대통령 임기 종료 · 목표 점수 {e.score.toFixed(1)}
        </li>
      )
    default:
      return null
  }
}
