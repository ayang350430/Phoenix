-- ============================================================
-- Phoenix 角色权限 & 代理推荐 迁移脚本
-- 执行方式: mysql -u goosd_admin -p goosd_admin < this_file.sql
-- ============================================================

USE goosd_admin;

-- 1. users 表添加推荐字段
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS referral_code VARCHAR(16) UNIQUE DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS referred_by   INT UNSIGNED DEFAULT NULL;

-- 2. 确保三个角色存在
INSERT IGNORE INTO roles (code, name, created_at) VALUES
  ('admin', '管理员',   NOW()),
  ('agent', '代理',     NOW()),
  ('user',  '普通用户', NOW());

-- 3. 没有角色的用户自动分配 '普通用户'
INSERT IGNORE INTO user_roles (user_id, role_id, created_at)
SELECT u.id, r.id, NOW()
FROM users u
CROSS JOIN roles r
WHERE r.code = 'user'
  AND NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id);

-- 4. 给所有用户生成 referral_code（6位随机码）
-- 通过后端启动时自动补全，这里不做
