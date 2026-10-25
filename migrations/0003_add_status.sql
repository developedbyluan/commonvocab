ALTER TABLE entries
ADD COLUMN status TEXT NOT NULL DEFAULT 'aigenerated'
CHECK (status IN ('pending', 'aigenerated', 'editorpicked', 'approved'));