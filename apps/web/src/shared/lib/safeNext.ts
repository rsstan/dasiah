// Where to go after signing in: only a path of this site (no other origin, no "//host").
export function safeNext(next: string | null): string {
  return next !== null && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}
