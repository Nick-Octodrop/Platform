ALTER TABLE jobs ADD COLUMN IF NOT EXISTS contact_id uuid;
CREATE INDEX IF NOT EXISTS idx_jobs_contact_id ON jobs(contact_id);
