-- Envelope tables keep immutable domain snapshots as JSONB; indexes/constraints enforce cross-process guarantees.
CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
DO $$ DECLARE t text; BEGIN
FOREACH t IN ARRAY ARRAY['admin_users','sessions','accounts','credentials','presets','preset_versions','bindings','schedules','jobs','generation_runs','content_versions','source_snapshots','assets','image_jobs','validation_runs','publish_attempts','posts','verification_runs','events','audit_events','connections','models','sources','runtime','heartbeats','idempotency'] LOOP
  EXECUTE format('CREATE TABLE IF NOT EXISTS %I (id text PRIMARY KEY,version integer NOT NULL DEFAULT 1 CHECK(version>0),data jsonb NOT NULL CHECK(jsonb_typeof(data)=''object''),created_at timestamptz NOT NULL DEFAULT date_trunc(''milliseconds'',clock_timestamp()),updated_at timestamptz NOT NULL DEFAULT clock_timestamp())', t);
END LOOP; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_account_pipeline ON jobs ((data->>'accountId')) WHERE data->>'kind' <> 'preview' AND data->>'state' IN ('queued','preparing','generating_text','validating','preparing_media','ready','submitting','retry_wait','submission_unknown');
CREATE UNIQUE INDEX IF NOT EXISTS job_idempotency ON jobs ((data->>'idempotencyScope')) WHERE data->>'idempotencyScope' IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS account_credential_fingerprint ON credentials ((data->>'fingerprint')) WHERE data->>'kind' = 'square' AND (data->>'active')::boolean;
CREATE UNIQUE INDEX IF NOT EXISTS assets_hash ON assets ((data->>'sha256'));
CREATE INDEX IF NOT EXISTS schedules_due ON schedules ((data->>'nextDueAt')) WHERE (data->>'enabled')::boolean;
CREATE INDEX IF NOT EXISTS jobs_retry ON jobs ((data->>'state'),(data->>'retryAt'));
CREATE INDEX IF NOT EXISTS posts_content ON posts USING gin (data jsonb_path_ops);
CREATE INDEX IF NOT EXISTS events_job ON events ((data->>'jobId'),created_at);
CREATE INDEX IF NOT EXISTS posts_order ON posts(created_at DESC,id DESC);
CREATE OR REPLACE FUNCTION prevent_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'immutable snapshot'; END $$;
DO $$ DECLARE t text; BEGIN
FOREACH t IN ARRAY ARRAY['preset_versions','generation_runs','content_versions','source_snapshots','validation_runs','events','audit_events','verification_runs'] LOOP
 IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname=t||'_immutable') THEN
  EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION prevent_snapshot_mutation()',t||'_immutable',t);
 END IF;
END LOOP; END $$;
INSERT INTO schema_migrations(version) VALUES(1) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS source_reads (id text PRIMARY KEY,version integer NOT NULL DEFAULT 1 CHECK(version>0),data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
-- Stable foreign keys accompany JSONB snapshots; no public API deletes historical entities.
DO $$ DECLARE t text; col text; target text; BEGIN
FOR t,col,target IN SELECT * FROM (VALUES
 ('jobs','accountId','accounts'),('jobs','presetVersionId','preset_versions'),
 ('preset_versions','presetId','presets'),('models','connectionId','connections'),
 ('generation_runs','jobId','jobs'),('content_versions','jobId','jobs'),
 ('content_versions','generationRunId','generation_runs'),
 ('posts','jobId','jobs'),('posts','contentId','content_versions'),
 ('publish_attempts','jobId','jobs'),('validation_runs','contentId','content_versions'),
 ('verification_runs','postId','posts'),('sessions','userId','admin_users')
) AS edges(t,c,r) LOOP
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname=t||'_'||lower(col)||'_fk') THEN
  EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS %I text GENERATED ALWAYS AS (data->>%L) STORED',t,lower(col)||'_ref',col);
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES %I(id)',t,t||'_'||lower(col)||'_fk',lower(col)||'_ref',target);
 END IF;
END LOOP;END $$;
CREATE UNIQUE INDEX IF NOT EXISTS preset_version_number ON preset_versions ((data->>'presetId'),(data->>'number'));
CREATE INDEX IF NOT EXISTS post_job_reference ON posts ((data->>'jobId'));
CREATE INDEX IF NOT EXISTS content_job_reference ON content_versions ((data->>'jobId'));
