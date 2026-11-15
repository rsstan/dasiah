import type { LegendClass } from './api/types.ts';

/** Same rows as db/seed/reference/accessibility.sql. */
export const LEGEND: LegendClass[] = [
  {
    code: 'excellent',
    label: 'Transit about as fast as a car',
    minRatio: 0,
    maxRatio: 1.2,
    color: '#1a9850',
    sortOrder: 1,
  },
  { code: 'good', label: 'Slightly slower than a car', minRatio: 1.2, maxRatio: 1.6, color: '#91cf60', sortOrder: 2 },
  { code: 'fair', label: 'Noticeably slower', minRatio: 1.6, maxRatio: 2, color: '#fee08b', sortOrder: 3 },
  { code: 'poor', label: 'About twice as slow or worse', minRatio: 2, maxRatio: 3, color: '#fc8d59', sortOrder: 4 },
  {
    code: 'very_poor',
    label: 'Three times slower or worse',
    minRatio: 3,
    maxRatio: null,
    color: '#d73027',
    sortOrder: 5,
  },
  {
    code: 'unreachable',
    label: 'Not reachable in the time limit',
    minRatio: null,
    maxRatio: null,
    color: '#737373',
    sortOrder: 6,
  },
  {
    code: 'no_transit',
    label: 'No stop within walking distance',
    minRatio: null,
    maxRatio: null,
    color: '#bdbdbd',
    sortOrder: 7,
  },
];
