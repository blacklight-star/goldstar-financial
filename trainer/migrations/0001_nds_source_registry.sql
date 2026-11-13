-- Staging-only source registry for immutable NDS PDF intake.
-- Apply only to goldstar_nds_staging. Never apply to a Production database.
CREATE TABLE IF NOT EXISTS gs_source_documents (
  source_id TEXT PRIMARY KEY,
  source_document_id TEXT,
  title TEXT NOT NULL,
  authors_json TEXT NOT NULL,
  publication_date TEXT,
  source_platform TEXT NOT NULL,
  source_url TEXT,
  source_origin_type TEXT NOT NULL,
  source_capture_method TEXT NOT NULL,
  source_role TEXT NOT NULL,
  authority_tier TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_sha256 TEXT NOT NULL UNIQUE,
  page_count INTEGER NOT NULL,
  pages_with_text INTEGER NOT NULL,
  visual_only_pages_json TEXT NOT NULL,
  visual_review_status TEXT NOT NULL,
  extraction_method TEXT NOT NULL,
  extracted_chars INTEGER NOT NULL,
  status TEXT NOT NULL,
  technical_review_status TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gs_source_chunks (
  chunk_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  section_title TEXT,
  language TEXT NOT NULL,
  content_type TEXT NOT NULL,
  content TEXT,
  content_sha256 TEXT,
  content_chars INTEGER NOT NULL,
  extraction_method TEXT NOT NULL,
  quality_status TEXT NOT NULL,
  review_status TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(source_id) REFERENCES gs_source_documents(source_id),
  UNIQUE(source_id, page_number)
);

CREATE TABLE IF NOT EXISTS gs_source_review_flags (
  review_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  page_refs TEXT NOT NULL,
  severity TEXT NOT NULL,
  issue_code TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL,
  disposition TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(source_id) REFERENCES gs_source_documents(source_id)
);

CREATE INDEX IF NOT EXISTS idx_gs_source_chunks_source_page
  ON gs_source_chunks(source_id, page_number);
CREATE INDEX IF NOT EXISTS idx_gs_source_documents_authority_status
  ON gs_source_documents(authority_tier, status);
CREATE INDEX IF NOT EXISTS idx_gs_source_review_source_status
  ON gs_source_review_flags(source_id, status);
