export function fetchUnavailable(): Error {
  return new Error('Dashboard backend is not configured');
}
