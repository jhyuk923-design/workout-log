# AIFFEL Campus Code Peer Review Templete
- 코더 : 김보겸
- 리뷰어 : 박준혁


# PRT(Peer Review Template)
[x]  **1. 주어진 문제를 해결하는 완성된 코드가 제출되었나요?**
- 문제에서 요구하는 기능이 정상적으로 작동하는지?
    - 해당 조건을 만족하는 부분의 코드 및 결과물을 근거로 첨부

과제에서 요구한 두 가지 개선안(체크 상태 DB 저장, 무게 입력 필드 추가)이 README에 명시되어 있고, 실제 코드에도 그대로 구현되어 있습니다.

`README.md`
```markdown
| 항목 | 구현 위치 |
| --- | --- |
| **개선안 1** 체크 상태를 DB에 저장 → 새로고침 후에도 유지 | `workout_logs.is_completed` 를 `upsert` (app.js `upsertLog`) |
| **개선안 2** 당일 수행 무게(kg) 입력 필드 추가 | `workout_logs.weight_kg` + 종목 카드의 `무게 (kg)` 입력 (− / + 스테퍼 포함) |
```

`app.js` (개선안 1 — 체크 상태를 upsert로 저장)
```js
function upsertLog(dISO, wid, patch) {
  var cur = logOf(dISO, wid) || { workout_date: dISO, workout_id: wid, is_completed: false, weight_kg: null, reps: null, sets: null };
  var row = Object.assign({}, cur, patch);
  S.logs[logKey(dISO, wid)] = row;                       // 낙관적 갱신
  return S.store.saveLog(row).then(function (saved) {
    if (saved) S.logs[logKey(dISO, wid)] = Object.assign({}, row, saved);
    setErr('');
  }, function (e) { setErr('저장 실패: ' + (e.message || e)); });
}
```

```js
saveLog: function (row) {
  return sb.from('workout_logs').upsert({
    workout_date: row.workout_date, workout_id: row.workout_id,
    is_completed: row.is_completed, weight_kg: row.weight_kg, reps: row.reps, sets: row.sets
  }, { onConflict: 'workout_date,workout_id' }).select().then(chk).then(function (d) { return d && d[0]; });
}
```

`app.js` (개선안 2 — 무게(kg) 입력 필드, 스테퍼 포함)
```js
if (!isSec) {
  fields += '<div class="ipt"><span class="ipt-k">무게 (kg)</span><div class="ipt-row">' +
    '<button class="stepper minus" data-act="step" data-f="weight_kg" data-dv="-2.5" aria-label="무게 감소">−</button>' +
    '<input type="number" step="0.5" min="0" inputmode="decimal" data-f="weight_kg" value="' + (l.weight_kg != null ? l.weight_kg : '') + '" placeholder="0" aria-label="' + esc(w.title) + ' 무게">' +
    '<button class="stepper plus" data-act="step" data-f="weight_kg" data-dv="2.5" aria-label="무게 증가">+</button>' +
    '</div></div>';
}
```

체크박스를 토글하거나 무게/횟수/세트를 입력하면 `upsertLog`가 즉시(입력은 0.4초 디바운스 후) Supabase에 `upsert`되고, `unique(workout_date, workout_id)` 제약으로 하루-종목당 한 행만 유지되므로 새로고침해도 상태가 사라지지 않습니다. Supabase 미설정 시에는 `LocalStore`로 자동 폴백해 동일한 인터페이스로 동작하는 것도 확인했습니다. 일/주/월/년 4개 뷰 전환, 달력·히트맵 클릭 이동 등 부가 기능도 모두 정상 동작합니다.

[x]  **2. 핵심적이거나 복잡하고 이해하기 어려운 부분에 작성된 설명을 보고 해당 코드가 잘 이해되었나요?**
- 해당 코드 블럭에 doc string/annotation/markdown이 달려 있는지 확인
- 해당 코드가 무슨 기능을 하는지, 왜 그렇게 짜여진건지, 작동 메커니즘이 뭔지 기술.
- 주석을 보고 코드 이해가 잘 되었는지 확인
    - 잘 작성되었다고 생각되는 부분을 근거로 첨부합니다.

`app.js` 상단에 전체 구조를 요약하는 헤더 주석이 있고, 직관적으로 이해하기 어려운 계산 로직(색상 단계, 볼륨 계산, 직전 기록 조회) 바로 위에 "왜" 그렇게 계산하는지를 짧게 설명하는 주석이 붙어 있어 로직을 따라가기 수월했습니다.

```js
/* 완료 종목 수 → 0~5 색 단계 */
function level(dISO) {
  var c = doneCount(dISO), t = S.workouts.length || 1;
  return c === 0 ? 0 : Math.min(5, Math.ceil(c / t * 5));
}
/* 볼륨 = 무게 x 횟수 x 세트 (플랭크는 무게가 없어 제외) */
function logVolume(w, l) {
  if (!l || !l.is_completed || w.unit !== 'reps') return 0;
  var kg = num(l.weight_kg), reps = num(l.reps) || w.rep_min || 0, sets = num(l.sets) || w.target_sets || 0;
  if (!kg) return 0;
  return kg * reps * sets;
}
```

```js
/* 직전에 이 종목을 수행한 기록 (점진적 과부하 참고용) */
function lastRecord(w, beforeISO) { ... }
```

특히 왜 `todos` 단일 테이블 구조를 그대로 쓰지 않고 `workouts`(종목 마스터)와 `workout_logs`(날짜별 기록)를 분리했는지에 대한 설명이 README와 커밋 메시지에 모두 남아 있어, 테이블 설계 의도를 코드만 보고도 이해할 수 있었습니다.

```markdown
튜토리얼의 단일 `todos` 표와 달리 **종목 마스터**와 **날짜별 기록**을 분리했습니다.
`todos` 처럼 한 표에 `is_completed` 를 두면 오늘 체크가 어제 기록을 덮어써서 1년 단위 추적이
불가능하기 때문입니다.
```

다만 함수 단위 doc string은 없고 한 줄짜리 주석 위주라서, `renderWeek`/`renderMonth`/`renderYear`처럼 긴 렌더링 함수 내부는 주석 없이 코드 흐름만으로 읽어야 하는 부분도 있습니다.

[ ]  **3. 에러가 난 부분을 디버깅하여 “문제를 해결한 기록”을 남겼나요? 또는 “새로운 시도 및 추가 실험”을 해봤나요?**
- 문제 원인 및 해결 과정을 잘 기록하였는지 확인
- 문제에서 요구하는 조건에 더해 추가적으로 수행한 나만의 시도, 실험이 기록되어 있는지 확인
    - 잘 작성되었다고 생각되는 부분을 캡쳐해 근거로 첨부합니다.

커밋 히스토리와 README를 확인했지만, 에러를 만나 원인을 찾고 해결한 과정을 기록한 부분(예: "처음엔 A로 시도했으나 B 문제가 발생해 C로 수정")은 찾지 못했습니다.

```
6d0fba3 GitHub Pages 배포 안내 추가, 안내 문구를 실제 파일명에 맞춤
8fbf440 운동 기록 앱: 일/주/월/년 4개 기간 보기 + Supabase 백엔드
```

커밋 메시지는 "무엇을 추가/수정했는지"는 잘 설명하고 있지만, 디버깅 과정이나 시행착오, 추가 실험에 대한 기록은 아니어서 이 항목은 충족되지 않은 것으로 판단했습니다. (Supabase 연결 실패 시 로컬 저장으로 폴백하는 방어 코드는 있으나, 이는 실제로 겪은 에러를 기록한 것이라기보다 코드에 내장된 예외 처리입니다.)

[ ]  **4. 회고를 잘 작성했나요?**
- 프로젝트 결과물에 대해 배운점과 아쉬운점, 느낀점 등이 상세히 기록 되어 있나요?
	- 딥러닝 모델의 경우, 인풋이 들어가 최종적으로 아웃풋이 나오기까지의 전체 흐름을 도식화하여 모델 아키텍쳐에 대한 이해를 돕고 있는지 확인

README, 커밋 메시지, 코드 주석 어디에도 배운 점 / 아쉬운 점 / 느낀 점을 정리한 회고 섹션이 없었습니다. README는 기능 설명과 실행 방법 위주로만 구성되어 있어, 이 항목은 충족되지 않은 것으로 판단했습니다.

[x]  **5. 코드가 간결하고 효율적인가요?**
- 파이썬 스타일 가이드 (PEP8)를 준수하였는지 확인
- 코드 중복을 최소화하고 범용적으로 사용할 수 있도록 모듈화(함수화) 했는지
    - 잘 작성되었다고 생각되는 부분을 근거로 첨부합니다.

(본 프로젝트는 Python이 아닌 바닐라 JS이므로 PEP8 대신 코드 일관성 · 모듈화 관점에서 확인했습니다.)

저장소 계층을 `LocalStore` / `makeSupabaseStore` 두 구현체로 분리해 동일한 인터페이스(`init/listWorkouts/fetchLogs/fetchDays/saveLog/saveDay`)로 맞춰 두었고, `boot()`에서 설정 여부에 따라 하나를 선택하도록 해 뷰 렌더링 코드가 저장소 종류를 신경 쓸 필요가 없도록 만들었습니다.

```js
function makeSupabaseStore(url, key) {
  var sb = window.supabase.createClient(url, key);
  function chk(res) { if (res.error) throw res.error; return res.data; }
  return {
    mode: 'supabase',
    init: function () { ... },
    listWorkouts: function () { ... },
    fetchLogs: function (from, to) { ... },
    fetchDays: function (from, to) { ... },
    saveLog: function (row) { ... },
    saveDay: function (row) { ... }
  };
}
```

또한 4개 뷰(일/주/월/년)에서 공통으로 쓰이는 조각들(`dotsHTML`, `dayTipHTML`, `statTile`, `bindTips`)을 함수로 뽑아내 중복 없이 재사용하고 있고, 뷰 전환도 `RENDER = { day, week, month, year }` 맵으로 깔끔하게 처리했습니다.

```js
var RENDER = { day: renderDay, week: renderWeek, month: renderMonth, year: renderYear };
function setView(v) {
  S.view = v;
  ['day', 'week', 'month', 'year'].forEach(function (k) {
    $('#view-' + k).hidden = k !== v;
    var t = document.querySelector('.tab[data-view="' + k + '"]');
    t.setAttribute('aria-selected', String(k === v));
  });
  render();
}
```


# 참고 링크 및 코드 개선

## 1.코드 리뷰 시 참고한 링크가 있다면 링크와 간략한 설명을 첨부합니다.

- [Supabase JS upsert 문서](https://supabase.com/docs/reference/javascript/upsert) — `saveLog`/`saveDay`에서 쓰인 `onConflict` 기반 upsert 동작 확인용.

## 2.코드 리뷰를 통해 개선을 제안할 코드가 있다면 코드와 간략한 설명을 첨부합니다.

`app.js`의 `renderDay` 안에서 무게 / 횟수·시간 / 세트 세 입력 블록이 스테퍼 버튼 두 개 + input 하나의 거의 동일한 마크업을 각각 문자열로 반복해서 만들고 있습니다(`app.js` 298~314줄 부근).

```js
if (!isSec) {
  fields += '<div class="ipt">...weight_kg...</div></div>';
}
fields += '<div class="ipt">...reps...</div></div>';
fields += '<div class="ipt">...sets...</div></div>';
```

이 세 블록을 `stepperField(label, field, value, minus, plus, placeholder)` 같은 헬퍼 함수로 뽑아내면 중복이 줄고, 필드를 추가/변경할 때(예: RPE 입력 추가) 실수로 한 곳만 고치는 사고를 줄일 수 있을 것 같습니다.


# 총평

과제에서 요구한 두 가지 개선안(체크 상태 DB 저장, 무게 입력 필드)이 정확한 위치(`upsertLog` / `workout_logs.weight_kg`)에 구현되어 있고, 저장소 계층 분리와 공통 렌더링 조각 재사용 등 모듈화도 잘 되어 있어 기능·구조 면에서는 완성도가 높습니다. `todos` 단일 테이블 대신 종목 마스터·날짜별 기록을 분리한 설계 의도도 README와 코드 주석에 잘 남아 있어 이해하기 쉬웠습니다. 다만 개발 중 겪은 에러와 그 해결 과정을 기록한 부분, 그리고 프로젝트를 마친 뒤의 회고(배운 점/아쉬운 점)가 보이지 않는 점은 아쉬웠습니다. 다음에는 README나 별도 문서에 트러블슈팅 로그와 회고 섹션을 추가해 주시면 더 좋을 것 같습니다.
