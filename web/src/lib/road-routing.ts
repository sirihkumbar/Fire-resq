export type LatLng = [number, number];

export type DrivingRoute = {
  coordinates: LatLng[];
  distanceKm: number;
  durationMinutes: number;
  instructions: string[];
};

type OsrmStep = {
  maneuver?: { type?: string; modifier?: string };
  name?: string;
  distance?: number;
};

type OsrmResponse = {
  code?: string;
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: { coordinates?: [number, number][] };
    legs?: Array<{ steps?: OsrmStep[] }>;
  }>;
};

export function hasValidCoordinates(latitude: unknown, longitude: unknown): latitude is number {
  return (
    typeof latitude === 'number' &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    typeof longitude === 'number' &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  );
}

export async function fetchDrivingRoute(
  origin: LatLng,
  destination: LatLng,
  signal?: AbortSignal
): Promise<DrivingRoute> {
  const [originLat, originLng] = origin;
  const [destinationLat, destinationLng] = destination;
  const url = `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destinationLng},${destinationLat}?overview=full&geometries=geojson&steps=true`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Driving route request failed');

  const data = (await response.json()) as OsrmResponse;
  const route = data.code === 'Ok' ? data.routes?.[0] : undefined;
  if (
    !route ||
    typeof route.distance !== 'number' ||
    typeof route.duration !== 'number' ||
    !route.geometry?.coordinates?.length
  ) {
    throw new Error('No driving route is available');
  }

  const instructions = (route.legs ?? []).flatMap((leg) =>
    (leg.steps ?? []).map((step) => {
      const maneuver = [step.maneuver?.type, step.maneuver?.modifier]
        .filter(Boolean)
        .join(' ');
      const road = step.name ? ` onto ${step.name}` : '';
      const distance =
        typeof step.distance === 'number' && Number.isFinite(step.distance)
          ? ` (${step.distance >= 1000 ? `${(step.distance / 1000).toFixed(1)} km` : `${Math.round(step.distance)} m`})`
          : '';
      return `${maneuver || 'Continue'}${road}${distance}`;
    })
  );

  return {
    coordinates: route.geometry.coordinates.map(([longitude, latitude]) => [latitude, longitude]),
    distanceKm: route.distance / 1000,
    durationMinutes: Math.max(1, Math.ceil(route.duration / 60)),
    instructions,
  };
}
