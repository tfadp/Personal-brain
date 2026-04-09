create table signals (
  id uuid default gen_random_uuid() primary key,
  summary text not null,
  topics text[],
  source_url text,
  source_title text,
  raw_input text not null,
  captured_at timestamp default now()
);

create table contacts (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  company text,
  role text,
  city text,
  country text,
  relationship_strength text check (relationship_strength in ('strong', 'medium', 'light')),
  how_you_know_them text,
  topics text[], -- array of tags
  last_meaningful_contact date,
  notes text,
  email text,
  linkedin_url text,
  contact_quality integer check (contact_quality in (1, 2, 3)), -- 1=noise, 2=weak tie, 3=real relationship
  follow_up boolean default false,   -- true = needs follow-up
  follow_up_note text,               -- context for the follow-up
  created_at timestamp default now(),
  updated_at timestamp default now()
);

-- Partial unique indexes to prevent duplicate imports
create unique index if not exists idx_contacts_email_unique
  on contacts (email)
  where email is not null;

create unique index if not exists idx_contacts_linkedin_unique
  on contacts (linkedin_url)
  where linkedin_url is not null;

-- Query performance indexes
create index if not exists idx_contacts_city     on contacts (lower(city));
create index if not exists idx_contacts_country  on contacts (lower(country));
create index if not exists idx_contacts_quality  on contacts (contact_quality);
create index if not exists idx_contacts_topics   on contacts using gin (topics);
create index if not exists idx_signals_captured  on signals (captured_at desc);
create index if not exists idx_signals_topics    on signals using gin (topics);
