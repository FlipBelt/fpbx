CREATE TABLE IF NOT EXISTS admin_actions (
  id CHAR(36) PRIMARY KEY,
  case_id CHAR(36) NOT NULL,
  actor_user_id VARCHAR(120) NOT NULL,
  actor_name VARCHAR(120) NOT NULL DEFAULT '',
  action VARCHAR(80) NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  idempotency_key VARCHAR(120) NULL DEFAULT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'requested',
  detail_json JSON NOT NULL,
  result_json JSON NOT NULL,
  created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL,
  UNIQUE KEY admin_actions_idempotency_uq (idempotency_key),
  KEY admin_actions_case_created_idx (case_id, created_at),
  CONSTRAINT admin_actions_case_fk FOREIGN KEY (case_id) REFERENCES support_cases(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
