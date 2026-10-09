// Verify the configured trust relationship without uploading a package or changing dist-tags.
const requestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
const requestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
if (!requestUrl || !requestToken) throw new Error('This check requires a GitHub Actions OIDC environment');
const url = new URL(requestUrl);
url.searchParams.set('audience', 'npm:registry.npmjs.org');
const identityResponse = await fetch(url, {headers:{Authorization:`Bearer ${requestToken}`},signal:AbortSignal.timeout(30000)});
if (!identityResponse.ok) throw new Error(`GitHub OIDC request failed: HTTP ${identityResponse.status}`);
const identity = await identityResponse.json();
if (!identity.value) throw new Error('GitHub did not return an OIDC identity token');
const response = await fetch('https://registry.npmjs.org/-/npm/v1/oidc/token/exchange/package/%40jat%2Fsubconverter-wasm', {method:'POST',headers:{Authorization:`Bearer ${identity.value}`},signal:AbortSignal.timeout(30000)});
if (response.status !== 201) throw new Error(`npm rejected the workflow identity: HTTP ${response.status}`);
const exchange = await response.json();
if (!exchange.token || exchange.token_type !== 'oidc') throw new Error('npm did not return an OIDC publishing token');
console.log(`npm OIDC exchange verified for @jat/subconverter-wasm; temporary token expires ${exchange.expires}`);
