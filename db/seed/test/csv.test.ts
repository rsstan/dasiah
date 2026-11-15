import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv.ts';

describe('parseCsv', () => {
  it('reads rows by header name and strips a BOM', () => {
    expect(parseCsv('﻿a,b\n1,2\n')).toEqual([{ a: '1', b: '2' }]);
  });

  it('handles quotes, doubled quotes, commas inside quotes and CRLF', () => {
    expect(parseCsv('id,name\r\n1,"Main St, ""Old"" Town"\r\n2,\r\n')).toEqual([
      { id: '1', name: 'Main St, "Old" Town' },
      { id: '2', name: '' },
    ]);
  });

  it('accepts a missing final newline and short rows', () => {
    expect(parseCsv('a,b,c\n1,2')).toEqual([{ a: '1', b: '2', c: '' }]);
  });
});
