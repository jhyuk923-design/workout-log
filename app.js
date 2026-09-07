/* ============================================================
   운동 기록 앱
   - 일 / 주 / 월 / 년 4가지 기간 보기
   - 개선안 1: is_completed 를 DB에 저장 → 새로고침 후에도 완료 상태 유지
   - 개선안 2: 당일 수행 무게(kg) 입력 필드 저장
   - Supabase 설정이 없으면 localStorage 로 동작 (오프라인/시연용)
   ============================================================ */
(function () {
  'use strict';

  var CFG = window.APP_CONFIG || {};
  var WEEKLY_GOAL = CFG.WEEKLY_GOAL || 3;

  /* ---------- 1개월 차 초보자 전신 무분할 루틴 (주 3회 격일) ---------- */
  var DEFAULT_ROUTINE = [
    { id: 'r1', title: '레그 프레스',        part: '하체', target: '12~15회 × 3세트', unit: 'reps', target_sets: 3, rep_min: 12, rep_max: 15, sort_order: 1, is_active: true },
    { id: 'r2', title: '체스트 프레스 머신', part: '가슴', target: '10~12회 × 3세트', unit: 'reps', target_sets: 3, rep_min: 10, rep_max: 12, sort_order: 2, is_active: true },
    { id: 'r3', title: '랫 풀 다운',         part: '등',   target: '10~12회 × 3세트', unit: 'reps', target_sets: 3, rep_min: 10, rep_max: 12, sort_order: 3, is_active: true },
    { id: 'r4', title: '머신 숄더 프레스',   part: '어깨', target: '10~12회 × 3세트', unit: 'reps', target_sets: 3, rep_min: 10, rep_max: 12, sort_order: 4, is_active: true },
    { id: 'r5', title: '플랭크',             part: '코어', target: '30~45초 × 3세트', unit: 'sec',  target_sets: 3, rep_min: 30, rep_max: 45, sort_order: 5, is_active: true }
  ];
  var PART_COLOR = { '하체': 'var(--p1)', '가슴': 'var(--p2)', '등': 'var(--p3)', '어깨': 'var(--p4)', '코어': 'var(--p5)' };
  var DOW = ['월', '화', '수', '목', '금', '토', '일'];

  /* ================= 유틸 ================= */
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var pad = function (n) { return String(n).padStart(2, '0'); };
  var iso = function (d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  var todayISO = function () { return iso(new Date()); };
  function parseISO(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
  function startOfWeek(d) { return addDays(d, -((d.getDay() + 6) % 7)); }  // 월요일 시작
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }
  function fmtKg(v) { return v == null ? '—' : (Math.round(v * 10) / 10) + ' kg'; }
  function fmtVol(v) {
    if (!v) return '0 kg';
    if (v >= 10000) return (Math.round(v / 100) / 10) + 'k kg';
    return Math.round(v).toLocaleString('ko-KR') + ' kg';
  }
  function fmtDateLong(d) {
    return d.getFullYear() + '년 ' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + DOW[(d.getDay() + 6) % 7] + ')';
  }

  /* ================= 저장소 ================= */
  var LocalStore = {
    mode: 'local',
    KEY: 'gymlog.v1',
    _read: function () { try { return JSON.parse(localStorage.getItem(this.KEY)) || {}; } catch (e) { return {}; } },
    _write: function (o) { try { localStorage.setItem(this.KEY, JSON.stringify(o)); } catch (e) { /* 용량 초과 등 */ } },
    init: function () {
      var d = this._read();
      if (!d.workouts || !d.workouts.length) d.workouts = DEFAULT_ROUTINE.map(function (w) { return Object.assign({}, w); });
      if (!d.logs) d.logs = {};
      if (!d.days) d.days = {};
      this._write(d);
      return Promise.resolve();
    },
    listWorkouts: function () {
      var d = this._read();
      return Promise.resolve((d.workouts || DEFAULT_ROUTINE).slice().sort(function (a, b) { return a.sort_order - b.sort_order; }));
    },
    fetchLogs: function (from, to) {
      var l = this._read().logs || {};
      return Promise.resolve(Object.keys(l).map(function (k) { return l[k]; })
        .filter(function (r) { return r.workout_date >= from && r.workout_date <= to; }));
    },
    fetchDays: function (from, to) {
      var l = this._read().days || {};
      return Promise.resolve(Object.keys(l).map(function (k) { return l[k]; })
        .filter(function (r) { return r.workout_date >= from && r.workout_date <= to; }));
    },
    saveLog: function (row) {
      var d = this._read(); d.logs = d.logs || {};
      d.logs[row.workout_date + '|' + row.workout_id] = row; this._write(d);
      return Promise.resolve(row);
    },
    saveDay: function (row) {
      var d = this._read(); d.days = d.days || {};
      d.days[row.workout_date] = row; this._write(d);
      return Promise.resolve(row);
    }
  };

  function makeSupabaseStore(url, key) {
    var sb = window.supabase.createClient(url, key);
    function chk(res) { if (res.error) throw res.error; return res.data; }
    return {
      mode: 'supabase',
      init: function () {
        // 종목 마스터가 비어 있으면 기본 루틴을 1회 시드
        return sb.from('workouts').select('id').limit(1).then(chk).then(function (rows) {
          if (rows && rows.length) return;
          var seed = DEFAULT_ROUTINE.map(function (w) {
            return { title: w.title, part: w.part, target: w.target, unit: w.unit,
                     target_sets: w.target_sets, rep_min: w.rep_min, rep_max: w.rep_max, sort_order: w.sort_order };
          });
          return sb.from('workouts').insert(seed).then(chk);
        });
      },
      listWorkouts: function () {
        return sb.from('workouts').select('*').eq('is_active', true).order('sort_order', { ascending: true }).then(chk);
      },
      fetchLogs: function (from, to) {
        return sb.from('workout_logs').select('*').gte('workout_date', from).lte('workout_date', to).then(chk);
      },
      fetchDays: function (from, to) {
        return sb.from('workout_days').select('*').gte('workout_date', from).lte('workout_date', to).then(chk);
      },
      saveLog: function (row) {
        return sb.from('workout_logs').upsert({
          workout_date: row.workout_date, workout_id: row.workout_id,
          is_completed: row.is_completed, weight_kg: row.weight_kg, reps: row.reps, sets: row.sets
        }, { onConflict: 'workout_date,workout_id' }).select().then(chk).then(function (d) { return d && d[0]; });
      },
      saveDay: function (row) {
        return sb.from('workout_days').upsert({
          workout_date: row.workout_date, memo: row.memo, body_weight_kg: row.body_weight_kg
        }, { onConflict: 'workout_date' }).select().then(chk).then(function (d) { return d && d[0]; });
      }
    };
  }

  /* ================= 상태 ================= */
  var S = {
    store: LocalStore,
    workouts: DEFAULT_ROUTINE,
    logs: {},           // 'YYYY-MM-DD|workout_id' -> row
    days: {},           // 'YYYY-MM-DD' -> row
    loadedYears: {},
    view: 'day',
    cursor: new Date(),
    err: ''
  };
  var logKey = function (d, w) { return d + '|' + w; };
  function logOf(d, w) { return S.logs[logKey(d, w)] || null; }
  function dayOf(d) { return S.days[d] || null; }

  function doneCount(dISO) {
    var n = 0;
    for (var i = 0; i < S.workouts.length; i++) {
      var l = logOf(dISO, S.workouts[i].id);
      if (l && l.is_completed) n++;
    }
    return n;
  }
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
  function dayVolume(dISO) {
    return S.workouts.reduce(function (a, w) { return a + logVolume(w, logOf(dISO, w.id)); }, 0);
  }
  function rangeDays(fromISO, toISO) {
    var out = [], d = parseISO(fromISO), end = parseISO(toISO);
    while (d <= end) { out.push(iso(d)); d = addDays(d, 1); }
    return out;
  }
  /* 직전에 이 종목을 수행한 기록 (점진적 과부하 참고용) */
  function lastRecord(w, beforeISO) {
    var best = null;
    for (var k in S.logs) {
      var r = S.logs[k];
      if (r.workout_id !== w.id || !r.is_completed) continue;
      if (r.workout_date >= beforeISO) continue;
      if (!best || r.workout_date > best.workout_date) best = r;
    }
    return best;
  }

  /* ================= 데이터 로드 ================= */
  function ensureYear(y) {
    if (S.loadedYears[y]) return Promise.resolve();
    var from = y + '-01-01', to = y + '-12-31';
    return Promise.all([S.store.fetchLogs(from, to), S.store.fetchDays(from, to)]).then(function (res) {
      (res[0] || []).forEach(function (r) { S.logs[logKey(r.workout_date, r.workout_id)] = r; });
      (res[1] || []).forEach(function (r) { S.days[r.workout_date] = r; });
      S.loadedYears[y] = true;
    });
  }

  /* ================= 쓰기 ================= */
  function upsertLog(dISO, wid, patch) {
    var cur = logOf(dISO, wid) || { workout_date: dISO, workout_id: wid, is_completed: false, weight_kg: null, reps: null, sets: null };
    var row = Object.assign({}, cur, patch);
    S.logs[logKey(dISO, wid)] = row;                       // 낙관적 갱신
    return S.store.saveLog(row).then(function (saved) {
      if (saved) S.logs[logKey(dISO, wid)] = Object.assign({}, row, saved);
      setErr('');
    }, function (e) { setErr('저장 실패: ' + (e.message || e)); });
  }
  function upsertDay(dISO, patch) {
    var cur = dayOf(dISO) || { workout_date: dISO, memo: null, body_weight_kg: null };
    var row = Object.assign({}, cur, patch);
    S.days[dISO] = row;
    return S.store.saveDay(row).then(function (saved) {
      if (saved) S.days[dISO] = Object.assign({}, row, saved);
      setErr('');
    }, function (e) { setErr('저장 실패: ' + (e.message || e)); });
  }

  /* ================= 툴팁 ================= */
  var TT = $('#tooltip');
  function showTip(el, html) {
    TT.innerHTML = html; TT.hidden = false;
    var r = el.getBoundingClientRect(), t = TT.getBoundingClientRect();
    var x = r.left + r.width / 2 - t.width / 2;
    x = Math.max(8, Math.min(x, window.innerWidth - t.width - 8));
    var y = r.top - t.height - 8;
    if (y < 8) y = r.bottom + 8;
    TT.style.left = x + 'px'; TT.style.top = y + 'px';
  }
  function hideTip() { TT.hidden = true; }
  function bindTips(root) {
    root.querySelectorAll('[data-tip]').forEach(function (el) {
      el.addEventListener('mouseenter', function () { showTip(el, el.getAttribute('data-tip')); });
      el.addEventListener('mouseleave', hideTip);
      el.addEventListener('focus', function () { showTip(el, el.getAttribute('data-tip')); });
      el.addEventListener('blur', hideTip);
    });
  }
  window.addEventListener('scroll', hideTip, true);

  /* ================= 공통 조각 ================= */
  function dotsHTML(dISO) {
    var any = doneCount(dISO) > 0;
    return '<span class="dots' + (any ? '' : ' empty') + '">' + S.workouts.map(function (w) {
      var l = logOf(dISO, w.id);
      return '<i class="dot-i' + (l && l.is_completed ? ' on' : '') + '"></i>';
    }).join('') + '</span>';
  }
  function dayTipHTML(dISO) {
    var d = parseISO(dISO), c = doneCount(dISO), t = S.workouts.length, vol = dayVolume(dISO), dm = dayOf(dISO);
    var s = '<b>' + (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + DOW[(d.getDay() + 6) % 7] + ')</b><br>';
    s += c === 0 ? '운동 기록 없음' : '완료 ' + c + '/' + t + '종목' + (vol ? ' · 볼륨 ' + fmtVol(vol) : '');
    if (dm && dm.memo) s += '<br>' + esc(dm.memo);
    return s;
  }
  function statTile(k, v, unit, note, good) {
    return '<div class="stat"><div class="stat-k">' + esc(k) + '</div>' +
      '<div class="stat-v">' + esc(v) + (unit ? '<small> ' + esc(unit) + '</small>' : '') + '</div>' +
      (note ? '<div class="stat-note' + (good ? ' good' : '') + '">' + esc(note) + '</div>' : '') + '</div>';
  }

  /* ================= 일 보기 ================= */
  function renderDay() {
    var dISO = iso(S.cursor), total = S.workouts.length, done = doneCount(dISO);
    var tISO = todayISO();

    $('#dayTitle').textContent = fmtDateLong(S.cursor);
    var diff = Math.round((parseISO(dISO) - parseISO(tISO)) / 86400000);
    $('#dayRelative').textContent = diff === 0 ? '오늘' : diff === -1 ? '어제' : diff === 1 ? '내일'
      : diff < 0 ? (-diff) + '일 전' : diff + '일 후';

    // 완료 링
    var ring = $('#dayRing'), C = 2 * Math.PI * 18;
    ring.style.strokeDasharray = C;
    ring.style.strokeDashoffset = C * (1 - (total ? done / total : 0));
    $('.ring-wrap').classList.toggle('full', done === total && total > 0);
    $('#dayDoneCount').textContent = done;
    $('.ring-num small').textContent = '/' + total;

    $('#daySummaryLine').textContent =
      done === 0 ? '아직 체크한 종목이 없습니다.' :
      done === total ? '오늘 루틴 전부 완료. 잘하셨습니다.' :
      '남은 종목 ' + (total - done) + '개.';

    // 이번 주 달성 횟수
    var ws = startOfWeek(S.cursor), wCount = 0;
    for (var i = 0; i < 7; i++) if (doneCount(iso(addDays(ws, i))) > 0) wCount++;
    $('#dayWeekCount').textContent = wCount + '/' + WEEKLY_GOAL + '회';
    $('#dayVolume').textContent = fmtVol(dayVolume(dISO));

    // 종목 카드
    $('#exList').innerHTML = S.workouts.map(function (w) {
      var l = logOf(dISO, w.id) || {};
      var isSec = w.unit === 'sec';
      var last = lastRecord(w, dISO);
      var hint = '';
      if (last) {
        hint = '<div class="ex-last">지난 기록 ' + (parseISO(last.workout_date).getMonth() + 1) + '/' + parseISO(last.workout_date).getDate() + ' · ' +
          (isSec ? (last.reps || '—') + '초' : fmtKg(last.weight_kg) + ' × ' + (last.reps || '—') + '회') +
          ' × ' + (last.sets || w.target_sets) + '세트</div>';
      }
      var fields = '';
      if (!isSec) {
        fields += '<div class="ipt"><span class="ipt-k">무게 (kg)</span><div class="ipt-row">' +
          '<button class="stepper minus" data-act="step" data-f="weight_kg" data-dv="-2.5" aria-label="무게 감소">−</button>' +
          '<input type="number" step="0.5" min="0" inputmode="decimal" data-f="weight_kg" value="' + (l.weight_kg != null ? l.weight_kg : '') + '" placeholder="0" aria-label="' + esc(w.title) + ' 무게">' +
          '<button class="stepper plus" data-act="step" data-f="weight_kg" data-dv="2.5" aria-label="무게 증가">+</button>' +
          '</div></div>';
      }
      fields += '<div class="ipt"><span class="ipt-k">' + (isSec ? '시간 (초)' : '횟수') + '</span><div class="ipt-row">' +
        '<button class="stepper minus" data-act="step" data-f="reps" data-dv="' + (isSec ? -5 : -1) + '" aria-label="감소">−</button>' +
        '<input type="number" step="1" min="0" inputmode="numeric" data-f="reps" value="' + (l.reps != null ? l.reps : '') + '" placeholder="' + w.rep_min + '" aria-label="' + esc(w.title) + (isSec ? ' 시간' : ' 횟수') + '">' +
        '<button class="stepper plus" data-act="step" data-f="reps" data-dv="' + (isSec ? 5 : 1) + '" aria-label="증가">+</button>' +
        '</div></div>';
      fields += '<div class="ipt"><span class="ipt-k">세트</span><div class="ipt-row">' +
        '<button class="stepper minus" data-act="step" data-f="sets" data-dv="-1" aria-label="세트 감소">−</button>' +
        '<input type="number" step="1" min="0" inputmode="numeric" data-f="sets" value="' + (l.sets != null ? l.sets : '') + '" placeholder="' + w.target_sets + '" aria-label="' + esc(w.title) + ' 세트">' +
        '<button class="stepper plus" data-act="step" data-f="sets" data-dv="1" aria-label="세트 증가">+</button>' +
        '</div></div>';

      return '<li class="ex' + (l.is_completed ? ' done' : '') + '" data-wid="' + esc(w.id) + '">' +
        '<input class="chk" type="checkbox" data-act="toggle"' + (l.is_completed ? ' checked' : '') + ' aria-label="' + esc(w.title) + ' 완료">' +
        '<div class="ex-body"><div class="ex-top">' +
          '<span class="part"><i style="background:' + (PART_COLOR[w.part] || 'var(--muted)') + '"></i>' + esc(w.part) + '</span>' +
          '<span class="ex-name">' + esc(w.title) + '</span>' +
          '<span class="ex-target">' + esc(w.target) + '</span>' +
        '</div>' + hint +
        '<div class="ex-inputs">' + fields + '</div></div></li>';
    }).join('');

    var dm = dayOf(dISO) || {};
    $('#bodyWeight').value = dm.body_weight_kg != null ? dm.body_weight_kg : '';
    $('#dayMemo').value = dm.memo || '';
    $('#dayCheckAll').textContent = done === total && total > 0 ? '전부 해제' : '전부 완료';
  }

  /* ================= 주 보기 ================= */
  function renderWeek() {
    var ws = startOfWeek(S.cursor), we = addDays(ws, 6), tISO = todayISO();
    var dates = [], i;
    for (i = 0; i < 7; i++) dates.push(iso(addDays(ws, i)));

    $('#weekTitle').textContent = (ws.getMonth() + 1) + '월 ' + Math.ceil((ws.getDate() + 6) / 7) + '주차';
    $('#weekRange').textContent = ws.getFullYear() + '. ' + (ws.getMonth() + 1) + '. ' + ws.getDate() +
      ' ~ ' + (we.getMonth() + 1) + '. ' + we.getDate();

    var trained = dates.filter(function (d) { return doneCount(d) > 0; }).length;
    var pct = Math.min(100, Math.round(trained / WEEKLY_GOAL * 100));
    $('#weekGoalText').textContent = trained + ' / ' + WEEKLY_GOAL + '회';
    var fill = $('#weekGoalFill');
    fill.style.width = pct + '%';
    fill.classList.toggle('met', trained >= WEEKLY_GOAL);

    $('#weekGrid').innerHTML = dates.map(function (d, k) {
      var dd = parseISO(d), lv = level(d);
      return '<button class="wcell' + (d === tISO ? ' is-today' : '') + (d > tISO ? ' future' : '') + '"' +
        ' data-date="' + d + '" data-tip="' + esc(dayTipHTML(d)) + '">' +
        '<span class="wcell-dow">' + DOW[k] + '</span>' +
        '<span class="wcell-d">' + dd.getDate() + '</span>' +
        dotsHTML(d) + '</button>';
    }).join('');
    bindTips($('#weekGrid'));

    var tb = $('#weekTable').querySelector('tbody');
    tb.innerHTML = S.workouts.map(function (w) {
      var cnt = 0, maxW = null, vol = 0, maxSec = null;
      dates.forEach(function (d) {
        var l = logOf(d, w.id);
        if (!l || !l.is_completed) return;
        cnt++;
        if (w.unit === 'sec') { var s = num(l.reps); if (s != null && (maxSec == null || s > maxSec)) maxSec = s; }
        else { var kg = num(l.weight_kg); if (kg != null && (maxW == null || kg > maxW)) maxW = kg; }
        vol += logVolume(w, l);
      });
      return '<tr><td>' + esc(w.title) + '</td>' +
        '<td class="' + (cnt ? '' : 'dim') + '">' + cnt + '회</td>' +
        '<td class="' + (maxW != null || maxSec != null ? '' : 'dim') + '">' + (w.unit === 'sec' ? (maxSec != null ? maxSec + ' 초' : '—') : fmtKg(maxW)) + '</td>' +
        '<td class="' + (vol ? '' : 'dim') + '">' + (w.unit === 'sec' ? '—' : fmtVol(vol)) + '</td></tr>';
    }).join('');
  }

  /* ================= 월 보기 ================= */
  function renderMonth() {
    var y = S.cursor.getFullYear(), m = S.cursor.getMonth(), tISO = todayISO();
    var first = new Date(y, m, 1), last = new Date(y, m + 1, 0), nDays = last.getDate();
    $('#monthTitle').textContent = y + '년 ' + (m + 1) + '월';

    var dates = [], i;
    for (i = 1; i <= nDays; i++) dates.push(iso(new Date(y, m, i)));
    var trained = dates.filter(function (d) { return doneCount(d) > 0; });
    var perfect = dates.filter(function (d) { return doneCount(d) === S.workouts.length && S.workouts.length; }).length;
    var goal = Math.round(nDays / 7 * WEEKLY_GOAL);
    var vol = dates.reduce(function (a, d) { return a + dayVolume(d); }, 0);
    $('#monthSub').textContent = '목표 ' + goal + '일 · 주 ' + WEEKLY_GOAL + '회 기준';

    $('#monthStats').innerHTML =
      statTile('운동한 날', trained.length, '일', '목표 ' + goal + '일 대비 ' + Math.round(trained.length / goal * 100) + '%', trained.length >= goal) +
      statTile('전 종목 완료', perfect, '일', perfect ? '5/5 달성' : '아직 없음', perfect > 0) +
      statTile('총 볼륨', fmtVol(vol), '', '무게 × 횟수 × 세트') +
      statTile('평균 체중', avgBodyWeight(dates), '', '기록한 날 평균');

    $('#calHead').innerHTML = DOW.map(function (d, k) {
      return '<div class="' + (k === 6 ? 'sun' : '') + '">' + d + '</div>';
    }).join('');

    var lead = (first.getDay() + 6) % 7, cells = '';
    for (i = 0; i < lead; i++) cells += '<div class="dcell pad"></div>';
    dates.forEach(function (d) {
      var dd = parseISO(d), c = doneCount(d), dm = dayOf(d);
      cells += '<button class="dcell' + (d === tISO ? ' is-today' : '') + (d > tISO ? ' future' : '') +
        (c && c === S.workouts.length ? ' perfect' : '') + (dm && dm.memo ? ' memo' : '') + '"' +
        ' data-date="' + d + '" data-tip="' + esc(dayTipHTML(d)) + '">' +
        '<span class="dcell-d">' + dd.getDate() + '</span>' + dotsHTML(d) + '</button>';
    });
    $('#cal').innerHTML = cells;
    bindTips($('#cal'));

    $('#calLegend').innerHTML =
      '<span class="lg-dots"><i class="dot-i on"></i><i class="dot-i on"></i><i class="dot-i"></i><i class="dot-i"></i><i class="dot-i"></i></span>' +
      ' 점 ' + S.workouts.length + '개 = 종목 ' + S.workouts.length + '개, 채워진 점이 그날 완료한 종목' +
      '<span class="lg-gap"></span><span class="lg-perfect"></span> 전 종목 완료' +
      '<span class="lg-gap"></span><span class="lg-memo"></span> 메모 있음' +
      '<span class="lg-gap"></span>날짜를 누르면 그날 기록으로 이동합니다.';
  }
  function avgBodyWeight(dates) {
    var vals = dates.map(function (d) { var x = dayOf(d); return x && num(x.body_weight_kg); }).filter(function (v) { return v != null; });
    if (!vals.length) return '—';
    return (Math.round(vals.reduce(function (a, b) { return a + b; }, 0) / vals.length * 10) / 10) + ' kg';
  }

  /* ================= 년 보기 ================= */
  function renderYear() {
    var y = S.cursor.getFullYear(), tISO = todayISO();
    $('#yearTitle').textContent = y + '년';

    var all = rangeDays(y + '-01-01', y + '-12-31');
    var trained = all.filter(function (d) { return doneCount(d) > 0; });
    var perfect = all.filter(function (d) { return S.workouts.length && doneCount(d) === S.workouts.length; }).length;

    // 주 단위 목표(주 3회) 달성 주 / 최장 연속
    var weeks = [], cur = startOfWeek(new Date(y, 0, 1));
    while (cur <= new Date(y, 11, 31)) {
      var n = 0;
      for (var i = 0; i < 7; i++) { var d = iso(addDays(cur, i)); if (d.slice(0, 4) === String(y) && doneCount(d) > 0) n++; }
      weeks.push({ start: iso(cur), count: n, inYear: iso(cur) <= y + '-12-31' });
      cur = addDays(cur, 7);
    }
    var metWeeks = 0, streak = 0, best = 0;
    weeks.forEach(function (w) {
      if (w.count >= WEEKLY_GOAL) { metWeeks++; streak++; if (streak > best) best = streak; }
      else if (w.count > 0 || w.start <= tISO) { streak = 0; }
    });
    var vol = all.reduce(function (a, d) { return a + dayVolume(d); }, 0);

    $('#yearSub').textContent = '주 ' + WEEKLY_GOAL + '회 기준 · ' + weeks.length + '주';
    $('#yearStats').innerHTML =
      statTile('운동한 날', trained.length, '일', '연 ' + Math.round(trained.length / all.length * 100) + '% 수행') +
      statTile('전 종목 완료', perfect, '일', perfect ? '5/5 달성한 날' : '아직 없음', perfect > 0) +
      statTile('목표 달성 주', metWeeks, '주', '최장 연속 ' + best + '주', best >= 4) +
      statTile('연간 총 볼륨', fmtVol(vol), '', '무게 × 횟수 × 세트');

    /* --- 히트맵: 열=주, 행=요일(월~일) --- */
    var start = startOfWeek(new Date(y, 0, 1)), end = new Date(y, 11, 31);
    var cols = [], c2 = new Date(start);
    while (c2 <= end) { cols.push(new Date(c2)); c2 = addDays(c2, 7); }

    var html = '<div class="heat-col heat-side">' +
      '<div class="hm-label"></div>' +
      DOW.map(function (d, k) { return '<div class="hm-label">' + (k % 2 === 0 ? d : '') + '</div>'; }).join('') +
      '</div>';

    var lastLabeled = -1;
    cols.forEach(function (colStart) {
      var label = '';
      for (var i = 0; i < 7; i++) {
        var d = addDays(colStart, i);
        if (d.getFullYear() === y && d.getDate() <= 7 && d.getMonth() !== lastLabeled) {
          label = (d.getMonth() + 1) + '월'; lastLabeled = d.getMonth(); break;
        }
      }
      var cells = '';
      for (var j = 0; j < 7; j++) {
        var dd = addDays(colStart, j), dISO = iso(dd);
        if (dd.getFullYear() !== y) { cells += '<div class="hc empty"></div>'; continue; }
        var lv = level(dISO);
        cells += '<button class="hc' + (dISO === tISO ? ' is-today' : '') + '" style="background:var(--h' + lv + ')"' +
          ' data-date="' + dISO + '" data-tip="' + esc(dayTipHTML(dISO)) + '"></button>';
      }
      html += '<div class="heat-col"><div class="hm-label">' + label + '</div>' + cells + '</div>';
    });
    $('#heat').innerHTML = html;
    bindTips($('#heat'));

    $('#heatLegend').innerHTML = '완료 종목 수 &nbsp;<span class="sw" style="background:var(--h0)"></span>0' +
      [1, 2, 3, 4, 5].map(function (n) { return '<span class="sw" style="background:var(--h' + n + ')"></span>' + n; }).join('') +
      '<span class="lg-gap"></span>칸을 누르면 그날 기록으로 이동합니다.';

    /* --- 월별 운동 일수 막대 --- */
    var monthly = [], mi;
    for (mi = 0; mi < 12; mi++) {
      var nd = new Date(y, mi + 1, 0).getDate(), n2 = 0;
      for (var k2 = 1; k2 <= nd; k2++) if (doneCount(iso(new Date(y, mi, k2))) > 0) n2++;
      monthly.push(n2);
    }
    var trueMax = Math.max.apply(null, monthly);      // 기록이 없으면 0
    var maxM = Math.max(trueMax, 1);                  // 높이 계산용 (0 나눗셈 방지)
    var maxIdx = trueMax > 0 ? monthly.indexOf(trueMax) : -1;
    $('#yearBarSub').textContent = trueMax > 0 ? '최다 ' + (maxIdx + 1) + '월 ' + trueMax + '일' : '아직 기록 없음';
    $('#yearBars').innerHTML = monthly.map(function (n, mi2) {
      var h = Math.round(n / maxM * 100);
      return '<div class="bar-col" data-tip="<b>' + (mi2 + 1) + '월</b><br>운동한 날 ' + n + '일">' +
        '<div class="bar-val">' + (n && mi2 === maxIdx ? n : '') + '</div>' +
        '<div class="bar-track"><div class="bar' + (n ? '' : ' zero') + '" style="height:' + (n ? Math.max(h, 3) : 2) + '%"></div></div>' +
        '<div class="bar-x">' + (mi2 + 1) + '</div></div>';
    }).join('');
    bindTips($('#yearBars'));

    /* --- 종목별 최고 기록 --- */
    $('#prTable').querySelector('tbody').innerHTML = S.workouts.map(function (w) {
      var bestRow = null;
      all.forEach(function (d) {
        var l = logOf(d, w.id);
        if (!l || !l.is_completed) return;
        var v = w.unit === 'sec' ? num(l.reps) : num(l.weight_kg);
        if (v == null) return;
        var bv = bestRow ? (w.unit === 'sec' ? num(bestRow.reps) : num(bestRow.weight_kg)) : null;
        if (bv == null || v > bv) bestRow = l;
      });
      if (!bestRow) return '<tr><td>' + esc(w.title) + '</td><td class="dim">—</td><td class="dim">—</td><td class="dim">—</td></tr>';
      var bd = parseISO(bestRow.workout_date);
      return '<tr><td>' + esc(w.title) + '</td>' +
        '<td>' + (w.unit === 'sec' ? bestRow.reps + ' 초' : fmtKg(bestRow.weight_kg)) + '</td>' +
        '<td>' + (bd.getMonth() + 1) + '/' + bd.getDate() + '</td>' +
        '<td>' + (bestRow.reps != null ? bestRow.reps + (w.unit === 'sec' ? '초' : '회') : '—') + ' × ' + (bestRow.sets || w.target_sets) + '세트</td></tr>';
    }).join('');
  }

  /* ================= 뷰 전환 ================= */
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
  function render() {
    hideTip();
    ensureYear(S.cursor.getFullYear()).then(function () { RENDER[S.view](); });
  }
  function setErr(msg) {
    S.err = msg;
    $('#footNote').textContent = msg ||
      (S.store.mode === 'supabase'
        ? 'Supabase 에 저장 중 · 체크·무게 모두 DB에 기록되어 새로고침 후에도 유지됩니다.'
        : 'Supabase 설정이 없어 이 브라우저(localStorage)에 저장합니다. config.js 에 URL/anon key 를 넣으면 DB로 전환됩니다.');
    if (msg) console.warn(msg);
  }

  /* ================= 이벤트 ================= */
  document.querySelectorAll('.tab').forEach(function (t) {
    t.addEventListener('click', function () { setView(t.dataset.view); });
  });

  // 기간 이동
  function stepCursor(view, dir) {
    var d = S.cursor;
    if (view === 'day') S.cursor = addDays(d, dir);
    else if (view === 'week') S.cursor = addDays(d, dir * 7);
    else if (view === 'month') S.cursor = new Date(d.getFullYear(), d.getMonth() + dir, Math.min(d.getDate(), 28));
    else S.cursor = new Date(d.getFullYear() + dir, d.getMonth(), Math.min(d.getDate(), 28));
    render();
  }
  ['day', 'week', 'month', 'year'].forEach(function (v) {
    $('#view-' + v).querySelectorAll('.nav').forEach(function (b) {
      b.addEventListener('click', function () { stepCursor(v, +b.dataset.step); });
    });
  });
  ['dayToday', 'weekToday', 'monthToday', 'yearToday'].forEach(function (id) {
    $('#' + id).addEventListener('click', function () { S.cursor = new Date(); render(); });
  });

  // 달력/히트맵 칸 클릭 → 해당 날짜 일 보기
  ['#weekGrid', '#cal', '#heat'].forEach(function (sel) {
    $(sel).addEventListener('click', function (e) {
      var b = e.target.closest('[data-date]');
      if (!b) return;
      S.cursor = parseISO(b.dataset.date);
      setView('day');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });

  // 종목 카드: 체크 / 스테퍼 / 입력
  var debTimer = {};
  function debounce(key, fn) {
    clearTimeout(debTimer[key]);
    debTimer[key] = setTimeout(fn, 400);
  }
  var exList = $('#exList');
  exList.addEventListener('change', function (e) {
    var li = e.target.closest('.ex'); if (!li) return;
    var dISO = iso(S.cursor), wid = li.dataset.wid;
    if (e.target.dataset.act === 'toggle') {
      var w = S.workouts.filter(function (x) { return x.id === wid; })[0] || {};
      var patch = { is_completed: e.target.checked };
      // 체크할 때 비어 있으면 목표 횟수/세트를 기본값으로 채워 둔다
      if (e.target.checked) {
        var l = logOf(dISO, wid) || {};
        if (l.reps == null) patch.reps = w.rep_min;
        if (l.sets == null) patch.sets = w.target_sets;
      }
      upsertLog(dISO, wid, patch).then(renderDay);
    }
  });
  exList.addEventListener('input', function (e) {
    var inp = e.target;
    if (inp.tagName !== 'INPUT' || !inp.dataset.f) return;
    var li = inp.closest('.ex'), dISO = iso(S.cursor), wid = li.dataset.wid;
    var patch = {}; patch[inp.dataset.f] = num(inp.value);
    debounce(wid + inp.dataset.f, function () {
      upsertLog(dISO, wid, patch).then(function () {
        // 요약(볼륨)만 갱신하고 입력 포커스는 유지
        $('#dayVolume').textContent = fmtVol(dayVolume(dISO));
      });
    });
  });
  exList.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act="step"]'); if (!b) return;
    var li = b.closest('.ex'), inp = li.querySelector('input[data-f="' + b.dataset.f + '"]');
    var w = S.workouts.filter(function (x) { return x.id === li.dataset.wid; })[0] || {};
    var base = num(inp.value);
    if (base == null) base = b.dataset.f === 'sets' ? w.target_sets : (b.dataset.f === 'reps' ? w.rep_min : 0);
    var v = Math.max(0, Math.round((base + parseFloat(b.dataset.dv)) * 10) / 10);
    inp.value = v;
    var dISO = iso(S.cursor), patch = {}; patch[b.dataset.f] = v;
    upsertLog(dISO, li.dataset.wid, patch).then(function () {
      $('#dayVolume').textContent = fmtVol(dayVolume(dISO));
    });
  });

  // 전부 완료 / 해제
  $('#dayCheckAll').addEventListener('click', function () {
    var dISO = iso(S.cursor), total = S.workouts.length, on = doneCount(dISO) !== total;
    Promise.all(S.workouts.map(function (w) {
      var l = logOf(dISO, w.id) || {};
      var patch = { is_completed: on };
      if (on) { if (l.reps == null) patch.reps = w.rep_min; if (l.sets == null) patch.sets = w.target_sets; }
      return upsertLog(dISO, w.id, patch);
    })).then(renderDay);
  });

  // 체중 / 메모
  $('#bodyWeight').addEventListener('input', function (e) {
    var dISO = iso(S.cursor), v = num(e.target.value);
    debounce('bw', function () { upsertDay(dISO, { body_weight_kg: v }); });
  });
  $('#dayMemo').addEventListener('input', function (e) {
    var dISO = iso(S.cursor), v = e.target.value;
    debounce('memo', function () { upsertDay(dISO, { memo: v }); });
  });

  /* ================= 부팅 ================= */
  function boot() {
    var st = $('#storeStatus'), txt = st.querySelector('.status-text');
    var useSb = CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase && window.supabase.createClient;

    var ready;
    if (useSb) {
      try {
        S.store = makeSupabaseStore(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
        ready = S.store.init().then(function () {
          st.className = 'status online'; txt.textContent = 'Supabase';
        }).catch(function (e) {
          // 연결 실패 시 로컬로 안전하게 폴백
          S.store = LocalStore;
          st.className = 'status local'; txt.textContent = '로컬 저장 (연결 실패)';
          setErr('Supabase 연결 실패: ' + (e.message || e) + ' — 로컬 저장으로 전환했습니다.');
          return LocalStore.init();
        });
      } catch (e) {
        S.store = LocalStore; ready = LocalStore.init();
        st.className = 'status local'; txt.textContent = '로컬 저장';
      }
    } else {
      S.store = LocalStore;
      ready = LocalStore.init().then(function () {
        st.className = 'status local'; txt.textContent = '로컬 저장';
      });
    }

    ready
      .then(function () { return S.store.listWorkouts(); })
      .then(function (ws) { if (ws && ws.length) S.workouts = ws; })
      .then(function () {
        var y = new Date().getFullYear();
        return ensureYear(y).then(function () { return ensureYear(y - 1); });
      })
      .then(function () { if (!S.err) setErr(''); setView('day'); })
      .catch(function (e) {
        setErr('초기화 실패: ' + (e.message || e));
        setView('day');
      });
  }
  boot();
})();
