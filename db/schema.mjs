import bcrypt from "bcryptjs";
import { pool } from "./pool.mjs";

const DUMMY_USERS = [
  {
    username: "alice.chen",
    name: "Alice Chen",
    email: "alice.chen@example.com",
    phoneNumber: "+14155550101",
    password: "Caplore123!",
  },
  {
    username: "bob.martins",
    name: "Bob Martins",
    email: "bob.martins@example.com",
    phoneNumber: "+919845550102",
    password: "Caplore456!",
  },
  {
    username: "carla.singh",
    name: "Carla Singh",
    email: "carla.singh@example.com",
    phoneNumber: "+442075550103",
    password: "Caplore789!",
  },
{
    username: "yuvraj.singh",
    name: "Yuvraj Singh",
    email: "yuvraj.singh@example.com",
    phoneNumber: "+919876543210",
    password: "Caplore012!",
  },
];

async function seedDummyUsers() {
  for (const user of DUMMY_USERS) {
    const passwordHash = await bcrypt.hash(user.password, 10);

    await pool.query(
      `INSERT INTO app_users (username, name, email, phone_number, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (username) DO NOTHING`,
      [user.username, user.name, user.email, user.phoneNumber, passwordHash],
    );
  }
}

export async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS form_submissions (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(80) NOT NULL,
      email VARCHAR(254) NOT NULL,
      phone VARCHAR(16) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_users (
      id BIGSERIAL PRIMARY KEY,
      username VARCHAR(40) UNIQUE NOT NULL,
      name VARCHAR(120) NOT NULL,
      email VARCHAR(254) NOT NULL,
      phone_number VARCHAR(16) NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS connections (
      id BIGSERIAL PRIMARY KEY,
      user_low_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      user_high_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      requester_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      status VARCHAR(10) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      responded_at TIMESTAMPTZ,
      CONSTRAINT connections_ordered_pair CHECK (user_low_id < user_high_id),
      CONSTRAINT connections_requester_in_pair CHECK (requester_id = user_low_id OR requester_id = user_high_id),
      CONSTRAINT connections_unique_pair UNIQUE (user_low_id, user_high_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_connections_user_low ON connections(user_low_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_connections_user_high ON connections(user_high_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_connections_status ON connections(status)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id BIGSERIAL PRIMARY KEY,
      author_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      category VARCHAR(20) NOT NULL DEFAULT 'question' CHECK (category IN ('deal_insight', 'market_update', 'question')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  try {
    await pool.query(`ALTER TABLE posts ADD COLUMN IF NOT EXISTS category VARCHAR(20) NOT NULL DEFAULT 'question'`);
    await pool.query(`ALTER TABLE posts ADD CONSTRAINT posts_category_check CHECK (category IN ('deal_insight', 'market_update', 'question')) NOT VALID`);
  } catch {
    // Column or constraint already exists — safe to ignore
  }
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_posts_author_created ON posts(author_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS post_images (
      id BIGSERIAL PRIMARY KEY,
      post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      object_key TEXT NOT NULL,
      position SMALLINT NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_post_images_post_id ON post_images(post_id)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS comments (
      id BIGSERIAL PRIMARY KEY,
      post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      author_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      body VARCHAR(1200) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_comments_post_created ON comments(post_id, created_at ASC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_comments_author_id ON comments(author_id)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS likes (
      id BIGSERIAL PRIMARY KEY,
      post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT likes_unique_post_user UNIQUE (post_id, user_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_likes_post_id ON likes(post_id)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_likes_user_id ON likes(user_id)`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bookmarks (
      id BIGSERIAL PRIMARY KEY,
      post_id BIGINT NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
      user_id BIGINT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT bookmarks_unique_post_user UNIQUE (post_id, user_id)
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bookmarks_user_created ON bookmarks(user_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_bookmarks_post_user ON bookmarks(post_id, user_id)`);

  await seedDummyUsers();
}
