# ChainSocial

ChainSocial is a Next.js app for experimenting with a web3 social feed.

## Setup

1. Install dependencies: `npm install`
2. Create `.env.local` with:
   - `NEXT_PUBLIC_PRIVY_APP_ID=<your_privy_app_id>`
   - `LENS_APP_ADDRESS=<your_lens_app_address>`
   - `LENS_POSTS_SOURCE=lens`
   - `CHAINSOCIAL_CHAIN_ONLY_WRITES=true`
   - `LENS_API_URL=https://api.lens.xyz/graphql` (recommended explicit Lens endpoint)
   - optional production backends:
     - `CHAINSOCIAL_STATE_BACKEND=file|postgres`
     - `DATABASE_URL=<postgres_connection_string>` (required when backend is `postgres`)
     - optional fail-fast DB settings:
       - `CHAINSOCIAL_STATE_FAILOVER_TO_FILE=true`
       - `CHAINSOCIAL_DB_CONNECT_TIMEOUT_MS=2500`
       - `CHAINSOCIAL_DB_QUERY_TIMEOUT_MS=3000`
       - `CHAINSOCIAL_DB_OPERATION_TIMEOUT_MS=3500`
       - `CHAINSOCIAL_DB_FAILOVER_COOLDOWN_MS=30000`
     - `CHAINSOCIAL_MEDIA_BACKEND=local|remote`
     - `CHAINSOCIAL_MEDIA_REMOTE_URL=<upload_service_url>` (when media backend is `remote`)
     - `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (for distributed rate limits)
3. Start dev server: `npm run dev`

## Compliance Controls

Region-aware compliance enforcement is enabled via `middleware.ts` and env flags in `.env.example`.

- Global read-only: `CHAINSOCIAL_GLOBAL_READ_ONLY=true`
- Full country block: `CHAINSOCIAL_BLOCKED_COUNTRIES=IN,CN`
- Country write block: `CHAINSOCIAL_WRITE_BLOCKED_COUNTRIES=BR`
- Feature kill switches globally or by country:
  - `CHAINSOCIAL_DISABLE_<FEATURE>=true`
  - `CHAINSOCIAL_DISABLE_<FEATURE>_COUNTRIES=US,DE`

See:
- `docs/DATA_CLASSIFICATION_MATRIX.md`
- `docs/COMPLIANCE_CHECKLIST.md`

EU baseline features now included:
- legal pages: `/legal/privacy`, `/legal/terms`, `/legal/cookies`, `/legal/dsa`
- DSAR helper endpoints (authenticated): `GET /api/privacy/export`, `DELETE /api/privacy/delete`
- DSAR intake/status endpoint (authenticated): `POST|GET /api/privacy/request`
- compliance admin endpoints (require `x-admin-token`):
  - `GET|PATCH /api/admin/compliance/dsar`
  - `POST /api/admin/compliance/retention`
- consent banner for optional local storage categories

Compliance runbooks/templates:
- `docs/ROPA_TEMPLATE.md`
- `docs/PROCESSOR_REGISTER_TEMPLATE.md`
- `docs/TRANSFER_IMPACT_ASSESSMENT_TEMPLATE.md`
- `docs/DSAR_RUNBOOK.md`
- `docs/RETENTION_POLICY.md`
- `docs/INCIDENT_RESPONSE_RUNBOOK.md`

## User Posting (Current Branch)

This branch focuses on local user posting and engagement, while keeping Lens auth for identity.

When `LENS_POSTS_SOURCE=lens`, the backend will attempt Lens first for:
- feed reads (`GET /api/posts`)
- post writes (`POST /api/posts`)
- reactions (`PATCH /api/posts/:id/likes`)
- replies (`POST /api/posts/:id/replies`)
- follows (`PATCH /api/follows/:address/toggle`)
- edit/delete (`PATCH|DELETE /api/posts/:id`)

If Lens queries or mutations fail, routes automatically fall back to local store responses where possible.

### API endpoints

- `GET /api/posts?limit=10&cursor=<cursor>&author=<wallet>`: cursor-based feed pagination.
- `POST /api/posts`: create a post (requires `lensAccessToken` cookie).
- `PATCH /api/posts/:id/likes`: like/unlike a post (requires auth).
- `GET /api/posts/:id/replies?limit=20&cursor=<cursor>`: paginated replies for a post.
- `POST /api/posts/:id/replies`: publish a reply.
- `PATCH /api/posts/:id`: edit your own post.
- `DELETE /api/posts/:id`: delete your own post.
- `GET /api/follows/:address`: follower/following counts + viewer follow state.
- `PATCH /api/follows/:address/toggle`: follow or unfollow a profile.
- `GET|POST /api/posts/migration`: legacy local UUID migration outbox (authenticated).
  - `POST` body `{ "action": "enqueue", "limit": 100 }` to enqueue local-only posts.
  - `POST` body `{ "action": "process", "limit": 25 }` to publish queued posts to Lens.

Legacy compatibility route remains available at `app/api/lens/create-post/route.ts`.

### Safeguards in place

- Server-side actor derivation from Lens auth cookie.
- Content sanitization and 280-char cap.
- Address normalization/validation.
- Per-wallet posting cooldown and minute-level rate cap.
- File-backed persistence at `data/posts.json`.
- Ownership checks for post edit/delete.
- Threaded replies with reply counts.
- Follow graph state and profile follow controls.

## Useful commands

- `npm run lint`
- `npx tsc --noEmit`
- `npm run test:posting`
