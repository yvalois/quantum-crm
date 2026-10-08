export function siblingStorageOrigin(requestUrl: string, headers: Headers): string | null {
  const url = new URL(requestUrl);
  if (url.protocol !== "https:") return null;
  const forwardedHost = headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwardedHost ?? headers.get("host") ?? url.hostname;
  if (!/^[a-z0-9.-]+(?::[0-9]{1,5})?$/iu.test(host)) return null;
  const hostname = host.replace(/:[0-9]{1,5}$/u, "");
  const labels = hostname.split(".");
  if (labels.length < 3 || labels.some((label) => !/^[a-z0-9-]+$/iu.test(label))) return null;
  return `https://storage.${labels.slice(1).join(".")}`;
}
