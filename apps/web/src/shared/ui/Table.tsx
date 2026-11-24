// A data table: columns describe how to render a row; numbers can be right-aligned.
import type { Key, ReactNode } from 'react';
import './Table.css';

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  align?: 'start' | 'end';
  /** Rendered as the row's header cell (th scope=row). */
  rowHeader?: boolean;
  /** Hidden on narrow screens. */
  optional?: boolean;
}

interface Props<T> {
  caption: string;
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => Key;
  className?: string;
}

export function Table<T>({ caption, columns, rows, rowKey, className }: Props<T>) {
  const cls = (c: Column<T>) =>
    [c.align === 'end' ? 'ui-table__num' : '', c.optional === true ? 'ui-table__optional' : '']
      .filter(Boolean)
      .join(' ') || undefined;
  return (
    <table className={['ui-table', className ?? ''].filter(Boolean).join(' ')}>
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((c) => (
            <th key={c.header} scope="col" className={cls(c)}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={rowKey(row)}>
            {columns.map((c) =>
              c.rowHeader === true ? (
                <th key={c.header} scope="row" className={cls(c)}>
                  {c.cell(row)}
                </th>
              ) : (
                <td key={c.header} className={cls(c)}>
                  {c.cell(row)}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
