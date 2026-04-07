# Cortex Contacts

A personal contact intelligence app. 

## What this does
Stores a personal network as structured data and enables natural 
language queries against it. "Who do I know in London in sports 
media" returns ranked results with context.

## Stack
- Next.js with App Router
- Supabase for database
- Claude API for query intelligence
- Tailwind for styling
- Vercel for hosting

## Key files
- /src/app/page.tsx — query interface
- /src/app/import/page.tsx — CSV upload
- /src/app/contacts/page.tsx — browse contacts
- /src/app/api/query/route.ts — natural language query handler
- /src/app/api/import/route.ts — CSV parser and importer
- /src/app/api/contacts/route.ts — CRUD

## Design principles
- Simple over clever
- Every query goes through Claude for ranking
- Results show: name, role, company, city, strength, topics, 
  last contact, notes
- No authentication needed — this is personal, local use only

## Database
Single table: contacts
See schema in /src/lib/schema.sql

## Environment variables needed
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
ANTHROPIC_API_KEY
