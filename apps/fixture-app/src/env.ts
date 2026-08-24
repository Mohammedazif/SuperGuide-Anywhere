export function fixturePort(): number {
  const raw = process.env["FIXTURE_PORT"];
  return raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : 8090;
}
