import express from "express";
import pg from "pg";
import bcrypt from "bcryptjs";

const { Pool } = pg;
const port = Number(process.env.PORT) || 3000;
const databaseUrl = process.env.DATABASE_URL;
const allowedOrigins = new Set(
  [
    "https://caplore.vercel.app",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    ...(process.env.ALLOWED_ORIGINS ?? "").split(","),
  ]
    .map((origin) => origin.trim())
    .filter(Boolean),
);

if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 5,
  idleTimeoutMillis: 30_000,
});

pool.on("error", (error) => {
  console.error("Unexpected PostgreSQL pool error", error);
});

async function initializeDatabase() {
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

  await seedDummyUsers();
}

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
];

const DUMMY_PASSWORD_HASH = bcrypt.hashSync("not-a-real-password", 10);

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

function parseSubmission(body) {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const phone = typeof body.phone === "string" ? body.phone.trim() : "";

  if (name.length < 2 || name.length > 80) {
    return { error: "Enter a name between 2 and 80 characters." };
  }

  if (
    email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    return { error: "Enter a valid email address." };
  }

  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    return { error: "Enter a valid international phone number." };
  }

  return { value: { name, email, phone } };
}

function parseLoginRequest(body) {
  const username = typeof body.username === "string" ? body.username.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (username.length < 1 || username.length > 40) {
    return { error: "Enter your username." };
  }

  if (password.length < 1 || password.length > 200) {
    return { error: "Enter your password." };
  }

  return { value: { username, password } };
}

const app = express();
app.disable("x-powered-by");
app.use("/api", (request, response, next) => {
  const origin = request.get("origin");

  if (origin && allowedOrigins.has(origin)) {
    response.set("Access-Control-Allow-Origin", origin);
    response.vary("Origin");
    response.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.set("Access-Control-Allow-Headers", "Content-Type");
  }

  if (request.method === "OPTIONS") {
    return origin && allowedOrigins.has(origin)
      ? response.sendStatus(204)
      : response.sendStatus(403);
  }

  return next();
});
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: false, limit: "16kb" }));

app.get("/api/health", async (_request, response) => {
  try {
    await pool.query("SELECT 1");
    response.json({ status: "ok", database: "connected" });
  } catch (error) {
    console.error("Health check failed", error);
    response.status(503).json({ status: "unavailable" });
  }
});

app.post("/api/submissions", async (request, response) => {
  const submission = parseSubmission(request.body ?? {});

  if (submission.error) {
    return response.status(400).json({ error: submission.error });
  }

  try {
    const result = await pool.query(
      `INSERT INTO form_submissions (name, email, phone)
       VALUES ($1, $2, $3)
       RETURNING id, created_at`,
      [
        submission.value.name,
        submission.value.email,
        submission.value.phone,
      ],
    );

    return response.status(201).json({
      success: true,
      submission: result.rows[0],
    });
  } catch (error) {
    console.error("Could not save form submission", error);
    return response
      .status(500)
      .json({ error: "Could not save your details. Please try again." });
  }
});

app.post("/api/login", async (request, response) => {
  const login = parseLoginRequest(request.body ?? {});

  if (login.error) {
    return response.status(400).json({ error: login.error });
  }

  try {
    const result = await pool.query(
      `SELECT username, name, email, phone_number, password_hash
       FROM app_users
       WHERE username = $1`,
      [login.value.username],
    );

    const user = result.rows[0];
    const passwordMatches = await bcrypt.compare(
      login.value.password,
      user ? user.password_hash : DUMMY_PASSWORD_HASH,
    );

    if (!user || !passwordMatches) {
      return response
        .status(401)
        .json({ error: "Invalid username or password." });
    }

    return response.status(200).json({
      success: true,
      user: {
        username: user.username,
        name: user.name,
        email: user.email,
        phone_number: user.phone_number,
      },
    });
  } catch (error) {
    console.error("Could not process login", error);
    return response
      .status(500)
      .json({ error: "Could not log you in. Please try again." });
  }
});

app.use("/api", (_request, response) => {
  response.status(404).json({ error: "Not found." });
});

async function start() {
  try {
    await initializeDatabase();
    app.listen(port, "0.0.0.0", () => {
      console.log(`Server listening on port ${port}`);
    });
  } catch (error) {
    console.error("Could not initialize PostgreSQL", error);
    process.exit(1);
  }
}

async function shutdown() {
  await pool.end();
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

start();
