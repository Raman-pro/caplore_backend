# Caplore Backend

Node.js/Express REST API for a real estate professional community platform. PostgreSQL + Cloudflare R2 for image storage.

**Frontend** lives in a separate directory and connects via CORS (`middleware/cors.mjs`). Allowed origins: `caplore.vercel.app`, `caplore.in`, `localhost:5173`, plus any extra in `ALLOWED_ORIGINS` env var.

## Structure

```
server.mjs                # Entry point: mounts routes, inits DB, starts server
├── db/
│   ├── pool.mjs          # PostgreSQL connection pool (pg)
│   └── schema.mjs        # Table DDL + seed data (4 dummy users)
├── lib/
│   ├── config.mjs        # Env var loading + validation
│   ├── jwt.mjs           # JWT sign/verify
│   ├── s3.mjs            # Cloudflare R2 presigned upload URLs
│   ├── validation.mjs    # Request body parsers
│   └── community-helpers.mjs  # Peer visibility checks
├── middleware/
│   ├── auth.mjs          # JWT Bearer auth
│   └── cors.mjs          # CORS with origin allowlist
└── routes/
    ├── misc.mjs          # Health check + lead form
    ├── auth.mjs          # Login
    ├── admin.mjs         # User CRUD (admin API key auth)
    ├── profile.mjs       # Public profiles
    ├── posts.mjs         # Posts, likes, comments
    ├── feed.mjs          # Paginated feed
    ├── connections.mjs   # Connection requests
    ├── bookmarks.mjs     # Bookmarks
    └── uploads.mjs       # Presigned image uploads
```

## API Routes

### Public

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | DB health check |
| `POST` | `/api/submissions` | Lead capture form (name, email, phone) |
| `POST` | `/api/login` | Login, returns JWT |
| `GET` | `/api/profile/:username` | Public profile + post/connection counts |

### Admin (`Authorization: Bearer <ADMIN_API_KEY>`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/users` | List all users |
| `POST` | `/api/admin/users` | Create user |
| `PATCH` | `/api/admin/users/:username` | Update user |
| `DELETE` | `/api/admin/users/:username` | Delete user |

### Authenticated (`Authorization: Bearer <JWT>`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/community/feed` | Paginated feed (self + connections). Query: `limit`, `before`, `category` |
| `POST` | `/api/community/posts` | Create post. Body: `{ body, category, imageKeys }` |
| `POST` | `/api/community/posts/:id/like` | Toggle like |
| `POST` | `/api/community/posts/:id/comments` | Add comment |
| `GET` | `/api/community/posts/:id/comments` | List comments |
| `POST` | `/api/community/posts/:id/bookmark` | Toggle bookmark |
| `GET` | `/api/community/bookmarks` | Paginated bookmarks |
| `POST` | `/api/community/connections` | Send connection request |
| `POST` | `/api/community/connections/:id/respond` | Accept/reject request |
| `GET` | `/api/community/connections` | List accepted connections |
| `GET` | `/api/community/connections/requests` | List pending requests |
| `GET` | `/api/community/connections/suggestions` | Suggested users |
| `POST` | `/api/community/uploads/presign` | Get presigned upload URLs (max 6 images) |

## Database (7 tables)

- **app_users** — users (username, name, email, phone, password_hash)
- **connections** — friend requests between users (canonical low/high ID ordering, status: pending/accepted/rejected)
- **posts** — user posts (body, category: deal_insight/market_update/question)
- **post_images** — images attached to posts (R2 object keys)
- **comments** — post comments (max 1200 chars)
- **likes** — post likes (unique per user+post, toggle via insert/delete)
- **bookmarks** — post bookmarks (unique per user+post, toggle)
- **form_submissions** — lead capture entries

## Key Decisions

- **No ORM** — raw SQL via `pg` pool
- **Two auth layers** — JWT for community, API key for admin
- **Visibility model** — posts visible only to self + accepted connections
- **Presigned uploads** — client uploads directly to R2, server never touches image bytes
- **Cursor pagination** — `before` timestamp cursors (not offset)
- **Express 5** (not 4)
