-- Fill start and end on usage text and note objects saved before those fields existed.
-- json_patch returns JSON, so json_group_array keeps an array of objects.
UPDATE entries
SET usage = (
  SELECT json_group_array(
    json_patch(
      value,
      json_object(
        'text', json_patch(
          json_extract(value, '$.text'),
          json_object(
            'start', COALESCE(json_extract(value, '$.text.start'), 0),
            'end', COALESCE(json_extract(value, '$.text.end'), 0)
          )
        ),
        'note', json_patch(
          json_extract(value, '$.note'),
          json_object(
            'start', COALESCE(json_extract(value, '$.note.start'), 0),
            'end', COALESCE(json_extract(value, '$.note.end'), 0)
          )
        )
      )
    )
  )
  FROM json_each(entries.usage)
)
WHERE json_valid(usage) = 1 AND usage != '[]';
