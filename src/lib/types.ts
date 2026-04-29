export interface Signal {
  id: string;
  summary: string;
  topics: string[] | null;
  source_url: string | null;
  source_title: string | null;
  raw_input: string;
  captured_at: string;
  // Populated at query time — not stored in DB
  linked_contacts?: { id: string; name: string }[];
}

export interface Interaction {
  id: string;
  contact_id: string;
  date: string;
  source: string; // manual | email | voice | screenshot
  raw_content: string;
  summary: string | null;
  topics: string[] | null;
  created_at: string;
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
  phone: string | null;            // E.164 format preferred (e.g. +14155551234)
  linkedin_url: string | null;
  contact_quality: number | null;   // 1=noise, 2=weak tie, 3=real relationship
  follow_up: boolean | null;        // true = waiting to hear from you
  follow_up_note: string | null;    // context e.g. "said let's catch up at Summit"
  contact_embedding?: number[] | null; // pgvector — populated by embed-contacts script
  created_at: string;
  updated_at: string;
  // Populated at query time for single-contact detail view — not stored in DB
  mentioned_in_signals?: {
    id: string;
    summary: string;
    source_title: string | null;
    source_url: string | null;
    captured_at: string;
  }[];
}

export interface Note {
  id: string;
  title: string;
  body: string;
  topics: string[];
  created_at: string;
  updated_at: string;
}

export interface SignalContact {
  signal_id: string;
  contact_id: string;
  created_at: string;
}
