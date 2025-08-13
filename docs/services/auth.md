# Auth Service

## Endpoints
- `POST /api/v1/auth/login` – login using email, password, and optional OTP.
- `GET /api/v1/auth/me` – return current authenticated user.

## Dependencies
- Prisma Client for database access.
- `bcrypt` for password hashing.
- `jsonwebtoken` for issuing access tokens.
- `otplib` for TOTP-based two-factor authentication.

## Environment Variables
- `JWT_SECRET` – signing key for issued JWTs.
- `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_CLIENT_SECRET` – Auth0 credentials.
- `AUTH0_AUDIENCE` – expected audience for Auth0 tokens.
- `AUTH0_MANAGEMENT_ID`, `AUTH0_MANAGEMENT_SECRET` – Auth0 management API access.
- `AUTH0_TEST_TOKEN` – optional token for testing.

## Getting a Signed JWT
1. Request Auth0 `domain`, `audience`, and `clientId` from the Launcx team.
2. Generate an RSA key pair and share the public key with Launcx.
3. Sign a JWT payload with the private key using algorithm `RS256`.
4. Exchange the signed JWT at `https://<domain>/oauth/token` to obtain an access token.
