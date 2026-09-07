-- ============================================================
--  운동 기록 앱 - Supabase 스키마
--  Supabase Dashboard > SQL Editor 에 붙여넣고 RUN 하세요.
-- ============================================================

-- ------------------------------------------------------------
-- 1) workouts : 루틴 종목 마스터 (튜토리얼의 todos 를 치환한 표)
-- ------------------------------------------------------------
create table if not exists public.workouts (
  id           uuid primary key default gen_random_uuid(),
  title        text    not null,                  -- 운동명            예) 레그 프레스
  part         text    not null,                  -- 부위             예) 하체
  target       text    not null,                  -- 권장 세트/횟수    예) 12~15회 × 3세트
  unit         text    not null default 'reps',   -- 'reps'(횟수) | 'sec'(초, 플랭크)
  target_sets  int     not null default 3,
  rep_min      int,
  rep_max      int,
  sort_order   int     not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 2) workout_logs : 날짜 x 종목 별 수행 기록
--    개선안 1) is_completed 를 DB 에 저장 -> 새로고침 후에도 유지
--    개선안 2) weight_kg 입력 필드 저장
-- ------------------------------------------------------------
create table if not exists public.workout_logs (
  id            uuid primary key default gen_random_uuid(),
  workout_date  date    not null,
  workout_id    uuid    not null references public.workouts(id) on delete cascade,
  is_completed  boolean not null default false,
  weight_kg     numeric(6,1),                     -- 개선안 2: 당일 수행 무게
  reps          int,                              -- 수행 횟수 (플랭크는 초)
  sets          int,
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (workout_date, workout_id)               -- 하루에 종목당 1행 (upsert 키)
);

create index if not exists workout_logs_date_idx on public.workout_logs (workout_date);

-- ------------------------------------------------------------
-- 3) workout_days : 하루 단위 메모 / 체중
-- ------------------------------------------------------------
create table if not exists public.workout_days (
  workout_date   date primary key,
  memo           text,
  body_weight_kg numeric(5,1),
  updated_at     timestamptz not null default now(),
  created_at     timestamptz not null default now()
);

-- ------------------------------------------------------------
-- 4) updated_at 자동 갱신 트리거
-- ------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists workout_logs_touch on public.workout_logs;
create trigger workout_logs_touch before update on public.workout_logs
  for each row execute function public.touch_updated_at();

drop trigger if exists workout_days_touch on public.workout_days;
create trigger workout_days_touch before update on public.workout_days
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- 5) RLS : 과제/개인용이므로 anon 키로 읽기·쓰기 허용
--    (여러 사람이 쓰는 서비스라면 auth.uid() 기반 정책으로 바꿔야 합니다)
-- ------------------------------------------------------------
alter table public.workouts      enable row level security;
alter table public.workout_logs  enable row level security;
alter table public.workout_days  enable row level security;

drop policy if exists "anon all workouts"     on public.workouts;
drop policy if exists "anon all workout_logs" on public.workout_logs;
drop policy if exists "anon all workout_days" on public.workout_days;

create policy "anon all workouts"     on public.workouts     for all using (true) with check (true);
create policy "anon all workout_logs" on public.workout_logs for all using (true) with check (true);
create policy "anon all workout_days" on public.workout_days for all using (true) with check (true);

-- ------------------------------------------------------------
-- 6) 시드 : 1개월 차 초보자 전신 무분할 루틴 (주 3회 격일)
-- ------------------------------------------------------------
insert into public.workouts (title, part, target, unit, target_sets, rep_min, rep_max, sort_order)
select * from (values
  ('레그 프레스',        '하체', '12~15회 × 3세트', 'reps', 3, 12, 15, 1),
  ('체스트 프레스 머신', '가슴', '10~12회 × 3세트', 'reps', 3, 10, 12, 2),
  ('랫 풀 다운',         '등',   '10~12회 × 3세트', 'reps', 3, 10, 12, 3),
  ('머신 숄더 프레스',   '어깨', '10~12회 × 3세트', 'reps', 3, 10, 12, 4),
  ('플랭크',             '코어', '30~45초 × 3세트', 'sec',  3, 30, 45, 5)
) as v(title, part, target, unit, target_sets, rep_min, rep_max, sort_order)
where not exists (select 1 from public.workouts);
