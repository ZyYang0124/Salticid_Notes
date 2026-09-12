-- 照片指纹注册表：同一张原图全站只允许上传一次，且删除后指纹保留（编号永不复用、重传被拒）
CREATE TABLE IF NOT EXISTS photo_hashes (
  hash TEXT PRIMARY KEY,
  public_id TEXT NOT NULL,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted INTEGER NOT NULL DEFAULT 0
);
