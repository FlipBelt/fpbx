CREATE TABLE IF NOT EXISTS support_cases (
  id CHAR(36) PRIMARY KEY,
  trace_id VARCHAR(120) NOT NULL,
  owner_user_id VARCHAR(120) NOT NULL DEFAULT '',
  owner_name VARCHAR(120) NOT NULL DEFAULT '',
  workflow_id VARCHAR(80) NOT NULL DEFAULT '',
  workflow_title VARCHAR(160) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'observing',
  source VARCHAR(32) NOT NULL DEFAULT 'system',
  current_revision INT NOT NULL DEFAULT 0,
  summary_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  UNIQUE KEY support_cases_trace_uq (trace_id),
  KEY support_cases_owner_updated_idx (owner_user_id, updated_at),
  KEY support_cases_status_updated_idx (status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS case_events (
  id CHAR(36) PRIMARY KEY,
  case_id CHAR(36) NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'info',
  actor_type VARCHAR(32) NOT NULL DEFAULT 'system',
  actor_user_id VARCHAR(120) NOT NULL DEFAULT '',
  actor_name VARCHAR(120) NOT NULL DEFAULT '',
  reason_code VARCHAR(80) NOT NULL DEFAULT '',
  reason VARCHAR(1000) NOT NULL DEFAULT '',
  detail_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  KEY case_events_case_created_idx (case_id, created_at),
  CONSTRAINT case_events_case_fk FOREIGN KEY (case_id) REFERENCES support_cases(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS client_events (
  id VARCHAR(120) PRIMARY KEY,
  case_id CHAR(36) NOT NULL,
  trace_id VARCHAR(120) NOT NULL,
  draft_id VARCHAR(120) NOT NULL DEFAULT '',
  sequence_no INT NOT NULL DEFAULT 0,
  owner_user_id VARCHAR(120) NOT NULL DEFAULT '',
  owner_name VARCHAR(120) NOT NULL DEFAULT '',
  event_type VARCHAR(80) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'info',
  workflow_id VARCHAR(80) NOT NULL DEFAULT '',
  workflow_title VARCHAR(160) NOT NULL DEFAULT '',
  client_at VARCHAR(48) NOT NULL DEFAULT '',
  server_at DATETIME(6) NOT NULL,
  app_version VARCHAR(80) NOT NULL DEFAULT '',
  summary_json JSON NOT NULL,
  KEY client_events_case_created_idx (case_id, server_at),
  KEY client_events_owner_created_idx (owner_user_id, server_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS server_events (
  id VARCHAR(160) PRIMARY KEY,
  case_id CHAR(36) NOT NULL,
  trace_id VARCHAR(120) NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'info',
  owner_user_id VARCHAR(120) NOT NULL DEFAULT '',
  owner_name VARCHAR(120) NOT NULL DEFAULT '',
  workflow_id VARCHAR(80) NOT NULL DEFAULT '',
  workflow_title VARCHAR(160) NOT NULL DEFAULT '',
  reason_code VARCHAR(80) NOT NULL DEFAULT '',
  reason VARCHAR(1000) NOT NULL DEFAULT '',
  summary_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  KEY server_events_case_created_idx (case_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS draft_revisions (
  id CHAR(36) PRIMARY KEY,
  case_id CHAR(36) NOT NULL,
  draft_id VARCHAR(120) NOT NULL DEFAULT '',
  revision INT NOT NULL,
  owner_user_id VARCHAR(120) NOT NULL DEFAULT '',
  owner_name VARCHAR(120) NOT NULL DEFAULT '',
  workflow_id VARCHAR(80) NOT NULL DEFAULT '',
  workflow_title VARCHAR(160) NOT NULL DEFAULT '',
  source VARCHAR(32) NOT NULL,
  snapshot_json JSON NOT NULL,
  snapshot_hash CHAR(64) NOT NULL,
  reason VARCHAR(1000) NOT NULL DEFAULT '',
  created_at DATETIME(6) NOT NULL,
  UNIQUE KEY draft_revisions_case_revision_uq (case_id, revision),
  KEY draft_revisions_owner_created_idx (owner_user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS attachment_artifacts (
  id CHAR(36) PRIMARY KEY,
  case_id CHAR(36) NOT NULL,
  owner_user_id VARCHAR(120) NOT NULL DEFAULT '',
  owner_name VARCHAR(120) NOT NULL DEFAULT '',
  workflow_id VARCHAR(80) NOT NULL DEFAULT '',
  workflow_title VARCHAR(160) NOT NULL DEFAULT '',
  file_name VARCHAR(255) NOT NULL,
  file_name_hash CHAR(64) NOT NULL,
  mime_type VARCHAR(120) NOT NULL DEFAULT '',
  file_size BIGINT NOT NULL DEFAULT 0,
  content_hash CHAR(128) NOT NULL DEFAULT '',
  kind VARCHAR(40) NOT NULL DEFAULT '',
  attachment_file_id VARCHAR(160) NOT NULL DEFAULT '',
  oss_bucket VARCHAR(120) NOT NULL DEFAULT '',
  oss_object_key VARCHAR(600) NOT NULL DEFAULT '',
  archive_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  expires_at DATETIME(6) NULL,
  ocr_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  KEY attachment_artifacts_case_created_idx (case_id, created_at),
  KEY attachment_artifacts_expire_idx (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
