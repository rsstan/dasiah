// Google encoded polyline (precision 5), accepted by OSRM as `polyline(...)` coordinates. Keeps
// the URL of a 500-point table request around 3 KB instead of 10 KB.

function encodeValue(value: number): string {
  let v = value < 0 ? ~(value << 1) : value << 1;
  let out = '';
  while (v >= 0x20) {
    out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
    v >>= 5;
  }
  return out + String.fromCharCode(v + 63);
}

/** Points as [lat, lon]. */
export function encodePolyline(points: readonly (readonly [number, number])[]): string {
  let lastLat = 0;
  let lastLon = 0;
  let out = '';
  for (const [lat, lon] of points) {
    const la = Math.round(lat * 1e5);
    const lo = Math.round(lon * 1e5);
    out += encodeValue(la - lastLat) + encodeValue(lo - lastLon);
    lastLat = la;
    lastLon = lo;
  }
  return out;
}

export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const next = (): number => {
    let result = 0;
    let shift = 0;
    let byte: number;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (index < encoded.length) {
    lat += next();
    lon += next();
    points.push([lat / 1e5, lon / 1e5]);
  }
  return points;
}
