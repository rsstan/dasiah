-- Reference data for accessibility: map legend. Idempotent.
-- Thresholds are a method decision of the thesis; change them here and bump
-- ALGO_VERSION in the accessibility service.
INSERT INTO accessibility.ratio_classes (class_id, code, label, min_ratio, max_ratio, color, sort_order) VALUES
  (1, 'excellent',   'Transit about as fast as a car', 0.00, 1.20, '#1a9850', 1),
  (2, 'good',        'Slightly slower than a car',     1.20, 1.60, '#91cf60', 2),
  (3, 'fair',        'Noticeably slower',              1.60, 2.00, '#fee08b', 3),
  (4, 'poor',        'About twice as slow or worse',   2.00, 3.00, '#fc8d59', 4),
  (5, 'very_poor',   'Three times slower or worse',    3.00, NULL, '#d73027', 5),
  (6, 'unreachable', 'Not reachable in the time limit', NULL, NULL, '#737373', 6),
  (7, 'no_transit',  'No stop within walking distance', NULL, NULL, '#bdbdbd', 7)
ON CONFLICT (class_id) DO UPDATE SET label = EXCLUDED.label, min_ratio = EXCLUDED.min_ratio,
  max_ratio = EXCLUDED.max_ratio, color = EXCLUDED.color, sort_order = EXCLUDED.sort_order;
