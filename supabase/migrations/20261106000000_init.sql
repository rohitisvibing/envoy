-- Envoy voice agent platform: initial schema (single-principal MVP).

create table if not exists principals (
  id uuid primary key default gen_random_uuid(),
  preferred_languages text[] not null default '{English}',
  communication_preferences text,
  background text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists profile_fields (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references principals(id) on delete cascade,
  key text not null,
  label text not null,
  value text,
  disclosure text not null default 'relevant'
    check (disclosure in ('always', 'relevant', 'approval', 'never')),
  is_custom boolean not null default false,
  position int not null default 0,
  unique (principal_id, key)
);

create table if not exists agent_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null,
  agent_type text not null,
  prompt_example text not null
);

create table if not exists missions (
  id uuid primary key default gen_random_uuid(),
  principal_id uuid not null references principals(id) on delete cascade,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'prepared', 'active', 'completed', 'failed')),
  raw_input text not null,
  agent_type text not null default 'Negotiator',
  title text not null,
  spec jsonb not null,
  extraction jsonb,
  brief jsonb,
  template_id uuid references agent_templates(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists missions_principal_updated on missions (principal_id, updated_at desc);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  mission_id uuid not null references missions(id) on delete cascade,
  mode text not null check (mode in ('simulated', 'live')),
  state text not null,
  negotiation jsonb not null default '{}'::jsonb,
  voice_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz
);
create index if not exists conversations_mission on conversations (mission_id);

create table if not exists transcript_events (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  speaker text not null check (speaker in ('agent', 'counterparty', 'user', 'system')),
  kind text not null check (kind in ('speech', 'instruction', 'event', 'approval')),
  text text not null,
  language text,
  is_final boolean not null default true,
  source text not null default 'text',
  meta jsonb not null default '{}'::jsonb,
  ts timestamptz not null default now()
);
create index if not exists transcript_events_conv_ts on transcript_events (conversation_id, ts);

create table if not exists approvals (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  kind text not null
    check (kind in ('info_disclosure', 'negotiation_authority', 'financial', 'final_commitment')),
  request text not null,
  proposed text not null,
  reason text not null default '',
  disclosure_key text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'alternative')),
  alternative_text text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists approvals_conv on approvals (conversation_id);

create table if not exists outcome_reports (
  conversation_id uuid primary key references conversations(id) on delete cascade,
  report jsonb not null,
  objective_achieved boolean not null,
  created_at timestamptz not null default now()
);

-- updated_at maintenance
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists principals_touch on principals;
create trigger principals_touch before update on principals
  for each row execute function touch_updated_at();

-- RLS: all access goes through the backend's service role for now. Enabling RLS with no
-- policies means the anon key cannot read or write anything.
alter table principals enable row level security;
alter table profile_fields enable row level security;
alter table agent_templates enable row level security;
alter table missions enable row level security;
alter table conversations enable row level security;
alter table transcript_events enable row level security;
alter table approvals enable row level security;
alter table outcome_reports enable row level security;
