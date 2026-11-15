-- Reference data for places. Idempotent.
INSERT INTO places.place_kinds (kind_id, code, label) VALUES
  (1, 'home', 'Home'), (2, 'work', 'Work'), (3, 'study', 'Study'), (4, 'other', 'Other')
ON CONFLICT (kind_id) DO UPDATE SET code = EXCLUDED.code, label = EXCLUDED.label;
