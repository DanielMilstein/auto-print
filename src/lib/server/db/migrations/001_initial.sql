CREATE TABLE settings (
	key text PRIMARY KEY,
	value text NOT NULL
);

CREATE TABLE sessions (
	token text PRIMARY KEY,
	created_at timestamptz NOT NULL DEFAULT now(),
	expires_at timestamptz NOT NULL
);

CREATE TABLE printers (
	id serial PRIMARY KEY,
	name text NOT NULL,
	brand text NOT NULL DEFAULT 'prusa',
	host text NOT NULL,
	api_key text NOT NULL DEFAULT '',
	vision_base_url text NOT NULL DEFAULT '',
	stop_on_failure boolean NOT NULL DEFAULT true,
	robot_gateway_url text NOT NULL DEFAULT '',
	robot_task text NOT NULL DEFAULT '',
	robot_params_json jsonb NOT NULL DEFAULT '{}',
	timelapse_enabled boolean NOT NULL DEFAULT false,
	timelapse_interval_sec integer NOT NULL DEFAULT 10,
	timelapse_fps integer NOT NULL DEFAULT 30,
	enabled boolean NOT NULL DEFAULT true,
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE batch_runs (
	id serial PRIMARY KEY,
	printer_id integer NOT NULL REFERENCES printers ON DELETE CASCADE,
	file_name text NOT NULL,
	total_count integer NOT NULL,
	completed_count integer NOT NULL DEFAULT 0,
	failure_detection boolean NOT NULL DEFAULT true,
	status text NOT NULL DEFAULT 'active',   -- active|paused_failure|paused_user|completed|cancelled|error
	phase text NOT NULL DEFAULT 'idle',      -- uploading|starting|printing|removing|idle
	current_job_id integer,
	robot_job_id text,
	started_at timestamptz NOT NULL DEFAULT now(),
	finished_at timestamptz
);

CREATE TABLE print_jobs (
	id serial PRIMARY KEY,
	printer_id integer NOT NULL REFERENCES printers ON DELETE CASCADE,
	batch_run_id integer REFERENCES batch_runs ON DELETE SET NULL,
	file_name text NOT NULL,
	prusalink_job_id integer,
	status text NOT NULL DEFAULT 'printing', -- printing|paused|finished|stopped|failed|error
	progress real NOT NULL DEFAULT 0,
	started_at timestamptz NOT NULL DEFAULT now(),
	finished_at timestamptz,
	failure_detected boolean NOT NULL DEFAULT false,
	failure_cause text,
	failure_image_path text,
	timelapse_path text
);

CREATE INDEX print_jobs_printer_idx ON print_jobs (printer_id, started_at DESC);
CREATE INDEX print_jobs_batch_idx ON print_jobs (batch_run_id);

CREATE TABLE events (
	id serial PRIMARY KEY,
	printer_id integer REFERENCES printers ON DELETE CASCADE,
	job_id integer REFERENCES print_jobs ON DELETE SET NULL,
	batch_run_id integer REFERENCES batch_runs ON DELETE SET NULL,
	type text NOT NULL,
	message text NOT NULL DEFAULT '',
	data_json jsonb NOT NULL DEFAULT '{}',
	created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX events_created_idx ON events (created_at DESC);
