-- Fix job_events FK to point at the new jobs table (not jobs_legacy).
-- Use NOT VALID to avoid failing if old rows still point at jobs_legacy.

alter table if exists job_events
  drop constraint if exists job_events_job_id_fkey;

alter table if exists job_events
  add constraint job_events_job_id_fkey
  foreign key (job_id) references jobs(id) on delete cascade
  not valid;

-- Optional: validate later once legacy rows are cleaned up.
-- alter table job_events validate constraint job_events_job_id_fkey;
