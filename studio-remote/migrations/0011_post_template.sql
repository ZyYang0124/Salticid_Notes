-- 札记版式模板：'classic' 为现有衬线长文；选择器白名单见服务端与公开站
ALTER TABLE posts ADD COLUMN template TEXT NOT NULL DEFAULT 'classic';
