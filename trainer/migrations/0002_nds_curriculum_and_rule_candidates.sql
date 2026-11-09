-- Staging-only curriculum and source-linked rule candidate schema.
-- Apply to goldstar_nds_staging only. Never apply this file to Production without owner approval.
CREATE TABLE IF NOT EXISTS gs_nds_curriculum_modules (
  module_id TEXT PRIMARY KEY,
  sequence_no INTEGER NOT NULL UNIQUE,
  title_en TEXT NOT NULL,
  title_fa TEXT NOT NULL,
  objective TEXT NOT NULL,
  source_refs_json TEXT NOT NULL,
  prerequisites_json TEXT NOT NULL,
  competency_outcomes_json TEXT NOT NULL,
  assessment_plan TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gs_nds_rule_candidates (
  candidate_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  source_document_id TEXT,
  source_url TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  source_page_sha256 TEXT NOT NULL,
  source_document_sha256 TEXT NOT NULL,
  source_excerpt TEXT NOT NULL,
  source_excerpt_sha256 TEXT NOT NULL,
  source_origin_type TEXT NOT NULL,
  source_capture_method TEXT NOT NULL,
  candidate_kind TEXT NOT NULL,
  rule_code TEXT NOT NULL,
  title TEXT NOT NULL,
  rule_statement TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  validation_status TEXT NOT NULL,
  approval_status TEXT NOT NULL,
  execution_eligible INTEGER NOT NULL DEFAULT 0,
  ambiguity_flags_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(source_id) REFERENCES gs_source_documents(source_id)
);

CREATE INDEX IF NOT EXISTS idx_nds_rule_candidate_status ON gs_nds_rule_candidates(validation_status, approval_status);
CREATE INDEX IF NOT EXISTS idx_nds_rule_candidate_source ON gs_nds_rule_candidates(source_id, page_number);
