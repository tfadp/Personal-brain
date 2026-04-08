export interface Signal {
  id: string;
  summary: string;
  topics: string[] | null;
  source_url: string | null;
  source_title: string | null;
  raw_input: string;
  captured_at: string;
}

export interface Contact {
  id: string;
  name: string;
  company: string | null;
  role: string | null;
  city: string | null;
  country: string | null;
  relationship_strength: string | null;
  how_you_know_them: string | null;
  topics: string[] | null;
  last_meaningful_contact: string | null;
  notes: string | null;
  email: string | null;
  linkedin_url: string | null;
  contact_quality: number | null;   // 1=noise, 2=weak tie, 3=real relationship
  follow_up: boolean | null;        // true = waiting to hear from you
  follow_up_note: string | null;    // context e.g. "said let's catch up at Summit"
  created_at: string;
  updated_at: string;
}
