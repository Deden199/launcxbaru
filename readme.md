## Get Signed JWT for Your Credential

1. Ask our team to create your client application for your organization. Our team will provide auth0's `domain` and `audience`, and a specified `clientId`
2. Launcx use Private JWT Token to authenticate, so you'll need to generate a PEM-formatted private and public key (we provide sample script to generate the keys), which you need to share with Launcx as verification method (only share the public key, keep the private key at a safe place)
3. Implement a service get your signed jwt (we provide an example for typescript, you can always implement it in your chosen language)
4. Call Launcx's API to generate token, which will be used to call Launcx's protected endpoints

### Sample Script in Typescript

```
const clientId = <auth-client-id>;
const domain = <auth-domain>;
const audience = <auth-audience>;

const TOKEN_URL = `https://${domain}/oauth/token`;

const payload = {
  iss: domain,
  sub: clientId,
  aud: TOKEN_URL,
  iat: Math.floor(Date.now() / 1000), // current time
  exp: Math.floor(Date.now() / 1000) + 60 * 5, // expiration time (5 minutes)
};

const signedJwt = jwt.sign(payload, privateKey, { algorithm: 'RS256' });
```

### Generate PEM-formatted Public and Private Keys

```
# generate private.pem
openssl genpkey -algorithm RSA -out private.pem -aes256

# generate public.pem
openssl rsa -pubout -in private.pem -out public.pem

# verify your public key
openssl pkey -pubin -in public.pem -text
```
# laucxserver

## Admin IP Whitelist

Super Admins can restrict certain administrative actions to specific IP addresses.

### API

- `GET /api/v1/admin/ip-whitelist` – returns the list of allowed IPs.
- `PUT /api/v1/admin/ip-whitelist` – update the allowed IPs with `{ "ips": ["1.1.1.1", "2.2.2.2"] }`.

The whitelist is stored in the `Setting` table under the key `admin_ip_whitelist`.
If the setting is missing or empty, no IP restriction is applied.

## Reconcile Partner Balances

This script recalculates `PartnerClient` balances based on settled orders and
pending/completed withdrawals.

```
npm run reconcile-balances
```

Make sure database environment variables are set before running the script. The
script prints a summary of balance adjustments to the console.

### Admin Panel Reconciliation

Admins can also trigger a balance recomputation from the web panel:

1. Log in to the admin panel and open a client's dashboard.
2. Click **Reconcile Balance** inside the *Active Balance* card.
3. The server recalculates the balance from settled orders minus withdrawals and the card refreshes with the new value.

