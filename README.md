# AI 무역 시뮬레이션

두 나라의 대통령이 교역 정책(관세·수출 통제·투자율)과 외교만으로 겨루는 게임이론 실험입니다. 두 나라는 문화가 달라 소비 취향과 노동 인구가 다릅니다. 대통령은 LLM, 규칙, 사람 중에서 고릅니다. 전쟁은 없고, 대통령은 4년마다 바뀌며, 실시간 모드에서는 현실 10분이 가상 1년입니다.

설계와 근거: [docs/SPEC.md](docs/SPEC.md) · 이론 기준선: [reports/baseline.md](reports/baseline.md) · Ossa(2014) 보정: [reports/calibration.md](reports/calibration.md)

## 시작

```bash
npm install
npm run dev
```

브라우저에서 http://localhost:5183 을 엽니다. 나라마다 대통령(사람/규칙/LLM)과 목표(절대 이익/상대 이익)를 고르고 시작합니다.

LLM 대통령을 쓰려면 `.env.example`을 `.env`로 복사하고 키를 직접 넣으세요. 앱은 셸 환경변수가 아니라 이 파일의 키만 읽습니다. `.env`는 git에 올라가지 않습니다.

### 무료로: 로컬 모델 (Ollama)

키도 요금도 없이 이 컴퓨터에서 공개 모델을 돌립니다.

1. https://ollama.com/download 에서 Ollama를 설치하고 켭니다.
2. 모델을 받습니다. 예: `ollama pull exaone3.5:7.8b` (LG, 한국어 특화, 약 4.8GB). 비교용으로 `qwen3:8b`, `gemma3:12b`.
3. 개발 서버를 새로고침하면 대통령 목록에 "로컬 무료: …"가 뜹니다. 실험 스크립트에서는 `ollama:<이름>`으로 씁니다.

메모리 16GB면 7~12B 모델이 적당합니다. 최신 유료 모델보다 작아 규칙 이해가 약할 수 있고, 호출 한 번에 수십 초~몇 분이 걸립니다. 대신 가중치가 고정되어 재현성이 좋습니다.

## 실험

```bash
npm run baseline                       # 이론 기준선 (무료)
npx tsx scripts/calibrate.ts           # 보정 격자 탐색 (무료)
npm run experiment -- --name rules --rules-only --objectives AA,RR,AR,RA --yes   # 규칙 대통령끼리 (무료)
npm run experiment -- --name pilot --models claude-haiku-5-5 --objectives AA --repeats 2   # 계획·비용만 출력
npm run experiment -- --name culture --models claude-haiku-5-5 --culture shown,hidden --repeats 5   # 문화 설명 있음/없음 비교 (계획만)
npm run experiment -- --name local --models ollama:exaone3.5:7.8b --culture shown,hidden --years 4 --yes   # 로컬 모델 (무료, 느림)
npm run report -- pilot                # 보고서 (무료)
npm run transcript -- pilot            # 게임별 행동 기록부: 생각·말·행동·자기 인식 (무료)
npm run experiment -- --name recap --models ollama:exaone3.5:7.8b --recap off,on --years 4 --yes   # 지난 분기 실제 변화를 알려주면 달라지나 (무료)
```

LLM 실험은 `--yes`를 붙여야 실제로 API를 호출합니다(요금 발생). 옵션은 `scripts/experiment.ts` 맨 위에 있습니다.

## 테스트

```bash
npm test
```
