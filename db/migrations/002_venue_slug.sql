-- Public venue pages live at /venue/<slug>.
ALTER TABLE venues ADD COLUMN slug TEXT;

WITH base AS (
  SELECT id,
         COALESCE(NULLIF(trim(both '-' from regexp_replace(lower(replace(name, '&', ' and ')), '[^a-z0-9]+', '-', 'g')), ''), 'venue') AS s
  FROM venues
), ranked AS (
  SELECT id, s, row_number() OVER (PARTITION BY s ORDER BY id) AS rn FROM base
)
UPDATE venues v
SET slug = CASE WHEN r.rn = 1 THEN r.s ELSE r.s || '-' || v.id END
FROM ranked r WHERE r.id = v.id;

ALTER TABLE venues ALTER COLUMN slug SET NOT NULL;
CREATE UNIQUE INDEX venues_slug_key ON venues (slug);
