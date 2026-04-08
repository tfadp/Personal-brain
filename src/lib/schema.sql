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
  relationship_strength text, -- strong / medium / light
  how_you_know_them text,
  topics text[], -- array of tags
  last_meaningful_contact text,
  notes text,
  email text,
  linkedin_url text,
  contact_quality integer,           -- 1=noise, 2=weak tie, 3=real relationship
  follow_up boolean default false,   -- true = needs follow-up
  follow_up_note text,               -- context for the follow-up
  created_at timestamp default now(),
  updated_at timestamp default now()
);
