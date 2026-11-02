ALTER TABLE users
ADD COLUMN role TEXT NOT NULL DEFAULT 'standard'
CHECK (role IN ('standard', 'premium', 'vip', 'vvip'));

ALTER TABLE messages
ADD COLUMN allowed_roles TEXT NOT NULL DEFAULT '["standard"]';
