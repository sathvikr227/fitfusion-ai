-- Backfill missing columns on supplements (existing tables created without these)
alter table supplements
  add column if not exists dosage numeric,
  add column if not exists unit text,
  add column if not exists timing text,
  add column if not exists notes text;

-- Force PostgREST to refresh its schema cache so the REST API picks up new columns
notify pgrst, 'reload schema';
