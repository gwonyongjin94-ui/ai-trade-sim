# AI 무역 시뮬레이션

**웹 지도:** 큰 세계 지도 한 장에 화면이 네 개 있습니다 (https://gwonyongjin94-ui.github.io/ai-trade-sim/).

| 화면 | 내용 |
|---|---|
| 자료 | 전 세계 나라의 2023년 실측 자료(GDP, 인구, 산업 구조, 나라 사이 상품 교역 10개 품목, 문화 지표). 나라를 누르면 오른쪽에 자료와 모든 교역 상대가, 지도에는 큰 상대 8곳으로 가는 흐름선이 뜹니다. '지표 보기'로 지도를 지표별로 칠합니다 |
| 관세 | 시뮬레이션이 시작점으로 쓰는 2023년 관세 (블록 6개 + 나머지 세계). 매기는 관세·받는 관세를 품목별로 지도와 표로 보고, 7 × 7 관세 행렬과 수출 통제를 봅니다 |
| 정책 실험 | 준비된 시나리오(자유무역, 미국의 대중 관세 인상, 미중 맞관세, 내시 균형 두 가지)나 직접 만든 정책 변경(누가·누구에게·품목·관세/수출 통제/투자율·시작 분기)을 v2 엔진으로 16분기 계산합니다. 브라우저의 Web Worker에서 돌고, 결과는 '2023년 그대로'와의 차이로 지도에 칠합니다. 주소를 복사하면 같은 실험을 공유할 수 있습니다 |
| AI 리플레이 | 로컬에서 돌린 실험 기록을 분기마다 다시 봅니다. 공개 성명은 말풍선, 비공개 메시지는 점선, 확전점수는 행위국 → 대상국 화살표, 유효한 약속은 녹색 선, 약속 위반은 깜빡이는 고리입니다. 사이트에는 API 키가 없습니다. 지금은 규칙 지도자 기록과 모의 응답 기록만 있고, 실제 AI(LLM) 지도자 기록은 유료 실행을 허락받은 뒤 추가합니다 |

값마다 연도와 출처를 함께 보여 줍니다.

연구 쪽은 6개 나라(블록)의 대통령이 교역 정책(관세·수출 통제·투자율)과 외교만으로 겨루는 게임이론 실험입니다. 대통령은 LLM, 규칙, 사람 중에서 고릅니다.

설계와 근거: [docs/SPEC.md](docs/SPEC.md) · v2 설계: [docs/V2_DESIGN.md](docs/V2_DESIGN.md) · 이론 기준선: [reports/baseline.md](reports/baseline.md) · Ossa(2014) 보정: [reports/calibration.md](reports/calibration.md)

## 시작

```bash
npm install
npm run dev
```

브라우저에서 http://localhost:5183 을 열면 지도가 뜹니다. `main`에 올리면 GitHub Actions가 테스트·빌드 후 GitHub Pages에 배포합니다 (`.github/workflows/pages.yml`).

### 지도 자료 다시 만들기

1. CEPII BACI(HS22, V202601) 파일을 https://www.cepii.fr/CEPII/en/bdd_modele/bdd_modele_item.asp?id=37 에서 받아 `data/raw/baci/`에 풀어 둡니다 (`BACI_HS22_Y2023_V202601.csv`, `country_codes_V202601.csv`). 약 300MB라 git에 올리지 않습니다.
2. `npm run world:wdi` — World Bank 지표를 받아 `data/world/wdi-2023.json`으로 줄입니다 (무료 공개 API 12번 호출, 응답은 `data/raw/`에 캐시).
3. `npm run map:data` — 둘을 합쳐 `src/web/data/world-2023.json`(나라 요약), `public/data/trade-2023/{ISO3}.json`(나라별 모든 교역 상대), `public/flags/`(국기)를 만듭니다.

### 리플레이 파일 다시 만들기

`npm run replay:export` — `runs/`의 실험 기록(git에 올리지 않음)에서 `public/replays/`를 만듭니다. 싣는 기록은 `scripts/export-replay.ts` 맨 위의 목록입니다. 실제 AI 실험(`npm run experiment:v2 -- ... --yes`)을 돌리면 그 기록을 목록에 `kind: 'llm'`으로 더합니다.

정책 실험 화면과 게임은 같은 엔진(`src/v2`)이라 같은 정책이면 결과가 같습니다. `src/web/modes.test.ts`가 정책 실험 결과를 규칙 지도자 리플레이 기록(도발, 미중 맞관세, 자유무역)과 맞춰 봅니다.

자료 출처: 나라 사이 교역은 CEPII BACI (Gaulier & Zignago 2010, Etalab Open License 2.0), 거시 지표는 World Bank WDI, 대만은 IMF WEO·대만 통계청, 북한 GDP는 한국은행 추정, 문화는 Hofstede (2015). 국기는 country-flag-icons (MIT). 관세와 시뮬레이션 엔진의 2023년 보정은 World Bank WITS(적용 관세), PIIE(미중 추가 관세), UN Comtrade(블록 사이 교역), World Bank·IMF(거시)입니다 (`npm run data:v2`, `tariffs:v2`, `production:v2`, `base:v2`).

예전 2개국(v1) 게임 화면(`src/ui`)은 더 이상 기본 화면이 아닙니다. 코드는 git 태그 `v1-two-country`에 남아 있습니다.

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
