// Regions are interpolated into AWS service hostnames. Keep this syntax guard
// shared by every boundary that accepts persisted or imported AWS regions.
export const AWS_REGION_PATTERN = /^[a-z]{2}-[a-z]+-\d{1,2}$/;

export function assertValidAwsRegion(region) {
  if (typeof region !== "string" || !AWS_REGION_PATTERN.test(region)) {
    throw new Error("Invalid region");
  }
  return region;
}
