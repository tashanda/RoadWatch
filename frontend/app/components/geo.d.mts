export function haversineMeters(
  latitude1: number,
  longitude1: number,
  latitude2: number,
  longitude2: number,
): number;
export function initialBearingDegrees(
  latitude1: number,
  longitude1: number,
  latitude2: number,
  longitude2: number,
): number;
export function bearingDifferenceDegrees(first: number, second: number): number;
export function shouldAlertForHazard(options: {
  distance: number;
  previousDistance: number | undefined;
  alertDistance: number;
  heading: number;
  bearing: number;
  accuracy: number;
  cooldownElapsed: boolean;
}): boolean;
export function pointAtDistance(
  latitude: number,
  longitude: number,
  bearing: number,
  distanceMeters: number,
): { latitude: number; longitude: number };
