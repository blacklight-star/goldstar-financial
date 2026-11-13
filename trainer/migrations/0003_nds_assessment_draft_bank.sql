-- Staging-only NDS assessment draft bank.
-- Apply to goldstar_nds_staging only. Items are unpiloted and not psychometrically validated.
CREATE TABLE IF NOT EXISTS gs_nds_assessment_items (
  item_id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_document_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  source_page_sha256 TEXT NOT NULL,
  question_fa TEXT NOT NULL,
  options_json TEXT NOT NULL,
  correct_option TEXT NOT NULL,
  explanation_fa TEXT NOT NULL,
  cognitive_level TEXT NOT NULL,
  difficulty_estimate TEXT NOT NULL,
  content_review_status TEXT NOT NULL,
  psychometric_status TEXT NOT NULL,
  pilot_status TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(module_id) REFERENCES gs_nds_curriculum_modules(module_id),
  FOREIGN KEY(source_id) REFERENCES gs_source_documents(source_id)
);
CREATE INDEX IF NOT EXISTS idx_nds_assessment_module
  ON gs_nds_assessment_items(module_id, content_review_status);
