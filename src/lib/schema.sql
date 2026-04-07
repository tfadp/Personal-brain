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
  created_at timestamp default now(),
  updated_at timestamp default now()
);
