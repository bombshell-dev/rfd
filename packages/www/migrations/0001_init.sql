CREATE TABLE pulls (
  uri TEXT PRIMARY KEY,
  cid TEXT NOT NULL,
  author_did TEXT NOT NULL,
  target_repo_uri TEXT NOT NULL,
  target_branch TEXT NOT NULL,
  source_repo_uri TEXT,
  source_branch TEXT,
  title TEXT NOT NULL,
  body TEXT,
  rounds_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open',
  state_updated_at TEXT,
  created_at TEXT NOT NULL,
  indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_pulls_target_created ON pulls (target_repo_uri, created_at DESC);

CREATE TABLE pull_files (
  pull_uri TEXT NOT NULL,
  file_path TEXT NOT NULL,
  proposal_slug TEXT,
  PRIMARY KEY (pull_uri, file_path),
  FOREIGN KEY (pull_uri) REFERENCES pulls(uri) ON DELETE CASCADE
);
CREATE INDEX idx_pull_files_slug ON pull_files (proposal_slug);

CREATE TABLE comments (
  uri TEXT PRIMARY KEY,
  cid TEXT NOT NULL,
  author_did TEXT NOT NULL,
  pull_uri TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_comments_pull ON comments (pull_uri, created_at);

CREATE TABLE issues (
  uri TEXT PRIMARY KEY,
  cid TEXT NOT NULL,
  author_did TEXT NOT NULL,
  target_repo_uri TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT,
  proposal_slug TEXT,
  created_at TEXT NOT NULL,
  indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_issues_slug ON issues (proposal_slug);

CREATE TABLE issue_comments (
  uri TEXT PRIMARY KEY,
  cid TEXT NOT NULL,
  author_did TEXT NOT NULL,
  issue_uri TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_issue_comments_issue ON issue_comments (issue_uri, created_at);
