const earthRadiusMeters = 6_371_000;

const radians = (degrees) => (degrees * Math.PI) / 180;
const degrees = (radiansValue) => (radiansValue * 180) / Math.PI;

export function haversineMeters(latitude1, longitude1, latitude2, longitude2) {
  const latitudeDelta = radians(latitude2 - latitude1);
  const longitudeDelta = radians(longitude2 - longitude1);
  const a =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(latitude1)) *
      Math.cos(radians(latitude2)) *
      Math.sin(longitudeDelta / 2) ** 2;
  const clampedA = Math.min(1, Math.max(0, a));
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(clampedA), Math.sqrt(1 - clampedA));
}

export function initialBearingDegrees(latitude1, longitude1, latitude2, longitude2) {
  const firstLatitude = radians(latitude1);
  const secondLatitude = radians(latitude2);
  const longitudeDelta = radians(longitude2 - longitude1);
  const y = Math.sin(longitudeDelta) * Math.cos(secondLatitude);
  const x =
    Math.cos(firstLatitude) * Math.sin(secondLatitude) -
    Math.sin(firstLatitude) * Math.cos(secondLatitude) * Math.cos(longitudeDelta);
  return (degrees(Math.atan2(y, x)) + 360) % 360;
}

export function bearingDifferenceDegrees(first, second) {
  return Math.abs(((first - second + 540) % 360) - 180);
}

export function shouldAlertForHazard({
  distance,
  previousDistance,
  alertDistance,
  heading,
  bearing,
  accuracy,
  cooldownElapsed,
}) {
  if (
    !Number.isFinite(accuracy) ||
    accuracy > 35 ||
    !Number.isFinite(heading) ||
    !Number.isFinite(bearing)
  ) {
    return false;
  }
  const aligned = bearingDifferenceDegrees(heading, bearing) <= 65;
  const approaching = previousDistance !== undefined && distance < previousDistance - 3;
  return aligned && approaching && distance <= alertDistance && cooldownElapsed;
}

export function pointAtDistance(latitude, longitude, bearing, distanceMeters) {
  const angularDistance = distanceMeters / earthRadiusMeters;
  const bearingRadians = radians(bearing);
  const firstLatitude = radians(latitude);
  const firstLongitude = radians(longitude);
  const secondLatitude = Math.asin(
    Math.sin(firstLatitude) * Math.cos(angularDistance) +
      Math.cos(firstLatitude) * Math.sin(angularDistance) * Math.cos(bearingRadians),
  );
  const secondLongitude =
    firstLongitude +
    Math.atan2(
      Math.sin(bearingRadians) * Math.sin(angularDistance) * Math.cos(firstLatitude),
      Math.cos(angularDistance) - Math.sin(firstLatitude) * Math.sin(secondLatitude),
    );
  return {
    latitude: degrees(secondLatitude),
    longitude: ((degrees(secondLongitude) + 540) % 360) - 180,
  };
}
