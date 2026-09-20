export function normalizePgConnectionString(connectionString: string): string {
  const url = new URL(connectionString);

  // node-postgres treats the libpq-compatible `sslmode=disable` query option as
  // an SSL request. Remove only that explicit mode; every other mode remains
  // available for environments where PostgreSQL terminates TLS itself.
  if (url.searchParams.get("sslmode") === "disable") {
    url.searchParams.delete("sslmode");
  }

  return url.toString();
}
