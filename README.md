# ChainSocial

ChainSocial is a Next.js app for experimenting with a web3 social feed.

## Setup

1. Install dependencies: `npm install`
2. Create `.env.local` with:
   - `NEXT_PUBLIC_PRIVY_APP_ID=<your_privy_app_id>`
   - `LENS_APP_ADDRESS=<your_lens_app_address>`
3. Start dev server: `npm run dev`

## User Posting (Current Branch)

This branch focuses on local user posting and engagement, while keeping Lens auth for identity.

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
