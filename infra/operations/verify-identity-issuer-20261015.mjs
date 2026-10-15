const issuer = process.env.QCRM_OIDC_ISSUER;
if (!issuer) throw new Error("Missing configured OIDC issuer");

const response = await fetch(`${issuer}/.well-known/openid-configuration`, {
  signal: AbortSignal.timeout(5000),
});
if (!response.ok) throw new Error(`OIDC discovery failed: ${response.status}`);
const discovery = await response.json();
if (discovery.issuer !== issuer) throw new Error("OIDC issuer mismatch");
console.log("OIDC issuer and discovery verified");
