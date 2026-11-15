// Saved places of the signed-in user. Every query is restricted to the caller's user id, so
// another user's place is simply "not found" (its existence is not revealed). The limit of 20
// places is enforced by the trigger saved_places_limit and surfaced as 409.
import { ConflictError, NotFoundError } from '@heatmap/common';
import type { AppContext } from '../context.ts';

export type PlaceKind = 'home' | 'work' | 'study' | 'other';

export interface PlaceInput {
  kind?: PlaceKind;
  label?: string;
  addressText?: string;
  cityCode?: string;
  location?: { lat: number; lon: number };
}

export interface SavedPlace {
  placeId: string;
  kind: PlaceKind;
  label: string;
  addressText: string;
  cityCode: string;
  location: { lat: number; lon: number };
  createdAt: string;
  updatedAt: string;
}

interface Row {
  place_id: string;
  kind: PlaceKind;
  label: string;
  address_text: string;
  city_code: string;
  lat: number;
  lon: number;
  created_at: Date;
  updated_at: Date;
}

const SELECT = `
  SELECT p.place_id, k.code AS kind, p.label, p.address_text, p.city_code,
         ST_Y(p.geom::geometry) AS lat, ST_X(p.geom::geometry) AS lon, p.created_at, p.updated_at
    FROM places.saved_places p JOIN places.place_kinds k ON k.kind_id = p.kind_id`;

const toPlace = (r: Row): SavedPlace => ({
  placeId: r.place_id,
  kind: r.kind,
  label: r.label,
  addressText: r.address_text,
  cityCode: r.city_code,
  location: { lat: r.lat, lon: r.lon },
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});

/** Database errors of the business rules -> 409 problems. */
function conflict(error: unknown): never {
  const e = error as { code?: string; constraint?: string; message?: string };
  if (e.code === '23505' && e.constraint === 'saved_places_label_uq') {
    throw new ConflictError('A saved place with this label already exists.', { type: '/problems/duplicate-label' });
  }
  if (e.code === '23514' && e.message?.includes('20 saved places') === true) {
    throw new ConflictError('At most 20 places can be saved.', { type: '/problems/place-limit' });
  }
  throw error;
}

export async function listPlaces(ctx: AppContext, userId: string): Promise<{ items: SavedPlace[] }> {
  const { rows } = await ctx.pool.query<Row>(`${SELECT} WHERE p.user_id = $1 ORDER BY p.created_at DESC, p.place_id`, [
    userId,
  ]);
  return { items: rows.map(toPlace) };
}

async function getPlace(ctx: AppContext, userId: string, placeId: string): Promise<SavedPlace> {
  const { rows } = await ctx.pool.query<Row>(`${SELECT} WHERE p.user_id = $1 AND p.place_id = $2`, [userId, placeId]);
  const row = rows[0];
  if (row === undefined) {
    throw new NotFoundError('No such place.');
  }
  return toPlace(row);
}

export async function createPlace(ctx: AppContext, userId: string, input: Required<PlaceInput>): Promise<SavedPlace> {
  let id: string;
  try {
    const { rows } = await ctx.pool.query<{ place_id: string }>(
      `INSERT INTO places.saved_places (user_id, kind_id, label, address_text, city_code, geom)
       SELECT $1, kind_id, $3, $4, $5, ST_SetSRID(ST_MakePoint($7, $6), 4326)::geography
         FROM places.place_kinds WHERE code = $2
       RETURNING place_id`,
      [userId, input.kind, input.label, input.addressText, input.cityCode, input.location.lat, input.location.lon],
    );
    id = rows[0]?.place_id ?? '';
  } catch (error) {
    conflict(error);
  }
  ctx.logger.info({ user_id: userId, place_id: id }, 'place saved');
  return getPlace(ctx, userId, id);
}

export async function updatePlace(
  ctx: AppContext,
  userId: string,
  placeId: string,
  input: PlaceInput,
): Promise<SavedPlace> {
  try {
    const { rowCount } = await ctx.pool.query(
      `UPDATE places.saved_places p SET
         kind_id      = coalesce((SELECT kind_id FROM places.place_kinds WHERE code = $3), p.kind_id),
         label        = coalesce($4, p.label),
         address_text = coalesce($5, p.address_text),
         city_code    = coalesce($6, p.city_code),
         geom         = CASE WHEN $7::float8 IS NULL THEN p.geom
                             ELSE ST_SetSRID(ST_MakePoint($8, $7), 4326)::geography END
       WHERE p.user_id = $1 AND p.place_id = $2`,
      [
        userId,
        placeId,
        input.kind ?? null,
        input.label ?? null,
        input.addressText ?? null,
        input.cityCode ?? null,
        input.location?.lat ?? null,
        input.location?.lon ?? null,
      ],
    );
    if (rowCount === 0) {
      throw new NotFoundError('No such place.');
    }
  } catch (error) {
    if (error instanceof NotFoundError) {
      throw error;
    }
    conflict(error);
  }
  return getPlace(ctx, userId, placeId);
}

export async function deletePlace(ctx: AppContext, userId: string, placeId: string): Promise<void> {
  const { rowCount } = await ctx.pool.query('DELETE FROM places.saved_places WHERE user_id = $1 AND place_id = $2', [
    userId,
    placeId,
  ]);
  if (rowCount === 0) {
    throw new NotFoundError('No such place.');
  }
}
