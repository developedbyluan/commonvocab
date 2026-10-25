-- json_extract raises "malformed JSON" on the older plain-text definitions.
-- json_valid returns 0 for those rows and leaves existing JSON objects unchanged.
UPDATE entries
SET definition = json_object('vietnamese', '', 'english', definition)
WHERE json_valid(definition) = 0;
