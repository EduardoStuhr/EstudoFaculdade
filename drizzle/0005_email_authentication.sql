-- Existing accounts must confirm ownership too; no data is removed.
ALTER TABLE users ADD COLUMN email_verified_at text;
--> statement-breakpoint
ALTER TABLE users ADD COLUMN session_version integer NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE auth_tokens (
  token_hash text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('verify', 'reset')),
  session_version integer NOT NULL,
  expires_at integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_auth_tokens_expiry ON auth_tokens(expires_at);
--> statement-breakpoint
CREATE TABLE auth_sessions (
  id text PRIMARY KEY NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_auth_sessions_expiry ON auth_sessions(expires_at);
--> statement-breakpoint
CREATE TABLE auth_rate_limits (
  key text PRIMARY KEY NOT NULL,
  attempts integer NOT NULL,
  expires_at integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX idx_auth_rate_limits_expiry ON auth_rate_limits(expires_at);
