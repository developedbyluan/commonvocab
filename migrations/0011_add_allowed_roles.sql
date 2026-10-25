ALTER TABLE entries
ADD COLUMN allowed_roles TEXT NOT NULL DEFAULT '["standard"]';
