# 운동 기록 앱 — 1개월 차 초보자 전신 무분할

Supabase Todo 튜토리얼의 `todos` 구조를 운동 기록으로 치환하고, **일 / 주 / 월 / 년** 네 가지 기간으로
수행 여부를 달력처럼 확인할 수 있게 만든 앱입니다.

## 과제 요구사항 대응

| 항목 | 구현 위치 |
| --- | --- |
| **개선안 1** 체크 상태를 DB에 저장 → 새로고침 후에도 유지 | `workout_logs.is_completed` 를 `upsert` (app.js `upsertLog`) |
| **개선안 2** 당일 수행 무게(kg) 입력 필드 추가 | `workout_logs.weight_kg` + 종목 카드의 `무게 (kg)` 입력 (− / + 스테퍼 포함) |

두 개선안 모두 반영되어 있습니다. 체크·무게·횟수·세트 전부 즉시 서버로 저장됩니다
(입력 필드는 타이핑이 멈춘 뒤 0.4초 디바운스).

## 기본 루틴 (주 3회 격일)

| 부위 | 운동 | 권장 |
| --- | --- | --- |
| 하체 | 레그 프레스 | 12~15회 × 3세트 |
| 가슴 | 체스트 프레스 머신 | 10~12회 × 3세트 |
| 등 | 랫 풀 다운 | 10~12회 × 3세트 |
| 어깨 | 머신 숄더 프레스 | 10~12회 × 3세트 |
| 코어 | 플랭크 | 30~45초 × 3세트 |

## 화면

- **일** — 오늘 루틴 체크리스트. 종목별 무게 / 횟수(플랭크는 초) / 세트 입력, 완료 링(3/5),
  그 종목의 **지난 기록**을 함께 보여 줘서 점진적 과부하를 바로 판단할 수 있게 했습니다.
  하단에 그날의 체중과 메모.
- **주** — 월~일 7칸. 칸마다 그날 완료한 종목이 점으로 표시되고, `주 3회` 목표 달성 막대와
  종목별 주간 최고 무게 / 볼륨 표가 붙습니다.
- **월** — 달력 격자. 각 날짜 칸에 **점 5개 = 종목 5개**, 채워진 점이 그날 완료한 종목입니다.
  전 종목 완료한 날은 칸 전체가 강조되고, 메모가 있는 날은 오른쪽 위에 점이 붙습니다.
  칸을 누르면 그날의 일 보기로 이동합니다.
- **년** — 1년 히트맵(열 = 주, 행 = 요일). 칸 색이 진할수록 그날 완료한 종목이 많습니다.
  월별 운동 일수 막대, 종목별 최고 기록(개인 기록) 표, 목표 달성 주 / 최장 연속 주 통계.

## 실행

### 1) Supabase 없이 바로 써 보기

```bash
python -m http.server 5173
```

브라우저에서 `http://localhost:5173` 접속. 설정이 비어 있으면 브라우저 `localStorage`에 저장되므로
기능은 전부 그대로 동작합니다(같은 브라우저에서만 유지).

### 2) Supabase 연결

1. Supabase 프로젝트 생성 후 **SQL Editor** 에서 `schema.sql` 전체를 실행합니다.
   테이블 3개와 기본 루틴 5종목이 만들어집니다.
2. `config.example.js` 를 `config.js` 로 복사한 뒤, **Project Settings → API** 에서
   URL 과 `anon` 키를 복사해 넣습니다. `config.js` 는 `.gitignore` 에 있어 커밋되지 않습니다.

```js
window.APP_CONFIG = {
  SUPABASE_URL: 'https://xxxxxxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOi...',
  WEEKLY_GOAL: 3,
};
```

3. 새로고침하면 우측 상단 표시가 `Supabase` 로 바뀝니다. 연결에 실패하면 자동으로
   로컬 저장으로 되돌아가고 하단에 이유가 표시됩니다.

> 로컬 모드에서 쌓인 기록은 Supabase 로 자동 이관되지 않습니다(종목 id 체계가 달라서).
> DB 로 쓸 계획이면 먼저 연결한 뒤 기록을 시작하세요.

### 3) GitHub Pages 로 공개 (링크만으로 열기)

https://weriousdf.github.io/workout-log/

저장소 Settings → Pages 에서 `main` 브랜치 루트로 설정돼 있습니다. `main` 에 푸시하면
1~2분 뒤 자동으로 반영됩니다.

이 공개 페이지는 **항상 로컬 저장(localStorage) 모드**입니다. `config.js` 는 커밋되지 않으니
Pages 에는 Supabase 키가 올라가지 않습니다 — 그리고 올리면 안 됩니다: `schema.sql` 의 RLS 가
anon 에 전체 권한을 주므로, 공개 페이지에 URL·anon 키가 실리면 누구나 이 기록을 읽고 쓸 수
있습니다. 기기 간 동기화가 필요하면 Supabase 를 붙인 로컬 실행이나 Artifact 버전을 쓰세요.

## 테이블 구조

```
workouts        루틴 종목 마스터
  id, title, part, target, unit('reps'|'sec'), target_sets, rep_min, rep_max, sort_order, is_active

workout_logs    날짜 x 종목 기록          ← 개선안 1 · 2 가 저장되는 표
  id, workout_date, workout_id, is_completed, weight_kg, reps, sets, updated_at
  unique(workout_date, workout_id)        ← upsert 키. 하루에 종목당 1행

workout_days    하루 단위 기록
  workout_date(PK), memo, body_weight_kg
```

튜토리얼의 단일 `todos` 표와 달리 **종목 마스터**와 **날짜별 기록**을 분리했습니다.
`todos` 처럼 한 표에 `is_completed` 를 두면 오늘 체크가 어제 기록을 덮어써서 1년 단위 추적이
불가능하기 때문입니다.

## 파일

| 파일 | 내용 |
| --- | --- |
| `index.html` | 화면 구조 |
| `styles.css` | 스타일 (라이트/다크 자동, 모바일 대응) |
| `app.js` | 저장소 추상화(Supabase ↔ localStorage), 4개 뷰 렌더링, 저장 로직 |
| `config.example.js` | Supabase 설정 템플릿 → `config.js` 로 복사해 사용 |
| `artifact/gym-log.html` | 같은 앱의 단일 파일 버전 (Claude Artifact 배포용) |
| `schema.sql` | 테이블 · RLS 정책 · 기본 루틴 시드 |

## RLS 주의

`schema.sql` 의 정책은 `anon` 키로 전체 읽기·쓰기를 허용합니다. **그래서 `config.js` 를 절대
공개 저장소에 올리면 안 됩니다** — URL 과 anon 키만 있으면 누구나 이 기록을 읽고 쓸 수 있습니다. 혼자 쓰는 과제/개인 기록용
전제입니다. 여러 사람이 쓰는 서비스로 확장하려면 `user_id uuid default auth.uid()` 컬럼을 추가하고
정책을 `using (user_id = auth.uid())` 로 바꿔야 합니다.
