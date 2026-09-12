-- 照片内容指纹：同一原图只允许上传一次（规则 19/20 的强化），删除记录后编号永不复用
ALTER TABLE media ADD COLUMN photo_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_media_photo_hash ON media (photo_hash);
-- 历史行回填指纹由迁移端点按需补齐（/studio/api/migrate/backfill-photo-hash）
