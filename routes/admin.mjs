import { Router } from "express";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { pool } from "../db/pool.mjs";
import { config } from "../lib/config.mjs";

const PASSWORD_MAX_LENGTH = 200;
const USERNAME_PATTERN = /^[a-zA-Z0-9._-]+$/;

export const adminRouter = Router();

function timingSafeEqualText(left, right) {
  const leftHash = crypto.createHash("sha256").update(left).digest();
  const rightHash = crypto.createHash("sha256").update(right).digest();
  return crypto.timingSafeEqual(leftHash, rightHash);
}

function requireAdmin(request, response, next) {
  const configuredKey = config.adminApiKey;

  if (!configuredKey) {
    return response.status(503).json({ error: "Admin API is not configured." });
  }

  const header = request.get("authorization") || "";
  const match = /^Bearer\s+(.+)$/.exec(header);

  if (!match || !timingSafeEqualText(match[1], configuredKey)) {
    return response.status(401).json({ error: "Invalid admin credentials." });
  }

  return next();
}

function normalizeUserPayload(body) {
  return {
    username: typeof body.username === "string" ? body.username.trim() : undefined,
    name: typeof body.name === "string" ? body.name.trim() : undefined,
    email: typeof body.email === "string" ? body.email.trim().toLowerCase() : undefined,
    phoneNumber:
      typeof body.phone_number === "string"
        ? body.phone_number.trim()
        : typeof body.phoneNumber === "string"
          ? body.phoneNumber.trim()
          : undefined,
    password: typeof body.password === "string" ? body.password : undefined,
  };
}

function validateUsername(username) {
  if (!username || username.length > 40 || !USERNAME_PATTERN.test(username)) {
    return "Username must be 1-40 letters, numbers, dots, underscores, or hyphens.";
  }
  return null;
}

function validateUserFields(payload, { requirePassword }) {
  const usernameError = validateUsername(payload.username);
  if (usernameError) return usernameError;

  if (!payload.name || payload.name.length < 2 || payload.name.length > 120) {
    return "Name must be between 2 and 120 characters.";
  }

  if (
    !payload.email ||
    payload.email.length > 254 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)
  ) {
    return "Enter a valid email address.";
  }

  if (!payload.phoneNumber || !/^\+[1-9]\d{7,14}$/.test(payload.phoneNumber)) {
    return "Enter a valid international phone number.";
  }

  if (requirePassword && (!payload.password || payload.password.length < 8)) {
    return "Password must be at least 8 characters.";
  }

  if (payload.password !== undefined && payload.password.length > PASSWORD_MAX_LENGTH) {
    return "Password is too long.";
  }

  return null;
}

function toAdminUser(row) {
  return {
    id: Number(row.id),
    username: row.username,
    name: row.name,
    email: row.email,
    phone_number: row.phone_number,
    created_at: row.created_at,
  };
}

adminRouter.use("/admin", requireAdmin);

adminRouter.get("/admin/users", async (_request, response) => {
  try {
    const result = await pool.query(
      `SELECT id, username, name, email, phone_number, created_at
       FROM app_users
       ORDER BY created_at DESC, id DESC`,
    );

    return response.json({
      success: true,
      users: result.rows.map(toAdminUser),
    });
  } catch (error) {
    console.error("Could not list admin users", error);
    return response.status(500).json({ error: "Could not load users." });
  }
});

adminRouter.post("/admin/users", async (request, response) => {
  const payload = normalizeUserPayload(request.body ?? {});
  const validationError = validateUserFields(payload, { requirePassword: true });

  if (validationError) {
    return response.status(400).json({ error: validationError });
  }

  try {
    const passwordHash = await bcrypt.hash(payload.password, 10);
    const result = await pool.query(
      `INSERT INTO app_users (username, name, email, phone_number, password_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, username, name, email, phone_number, created_at`,
      [payload.username, payload.name, payload.email, payload.phoneNumber, passwordHash],
    );

    return response.status(201).json({
      success: true,
      user: toAdminUser(result.rows[0]),
    });
  } catch (error) {
    if (error.code === "23505") {
      return response.status(409).json({ error: "Username is already taken." });
    }

    console.error("Could not create admin user", error);
    return response.status(500).json({ error: "Could not create user." });
  }
});

adminRouter.patch("/admin/users/:username", async (request, response) => {
  const currentUsername = typeof request.params.username === "string" ? request.params.username.trim() : "";
  const currentUsernameError = validateUsername(currentUsername);

  if (currentUsernameError) {
    return response.status(400).json({ error: "Invalid user selected." });
  }

  const payload = normalizeUserPayload(request.body ?? {});
  const validationError = validateUserFields(payload, { requirePassword: false });

  if (validationError) {
    return response.status(400).json({ error: validationError });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(`SELECT id FROM app_users WHERE username = $1 FOR UPDATE`, [
      currentUsername,
    ]);

    if (!existing.rows[0]) {
      await client.query("ROLLBACK");
      return response.status(404).json({ error: "User not found." });
    }

    let passwordHash = null;
    if (payload.password) {
      passwordHash = await bcrypt.hash(payload.password, 10);
    }

    const result = await client.query(
      `UPDATE app_users
       SET username = $1,
           name = $2,
           email = $3,
           phone_number = $4,
           password_hash = COALESCE($5, password_hash)
       WHERE username = $6
       RETURNING id, username, name, email, phone_number, created_at`,
      [
        payload.username,
        payload.name,
        payload.email,
        payload.phoneNumber,
        passwordHash,
        currentUsername,
      ],
    );

    await client.query("COMMIT");

    return response.json({
      success: true,
      user: toAdminUser(result.rows[0]),
    });
  } catch (error) {
    await client.query("ROLLBACK");

    if (error.code === "23505") {
      return response.status(409).json({ error: "Username is already taken." });
    }

    console.error("Could not update admin user", error);
    return response.status(500).json({ error: "Could not update user." });
  } finally {
    client.release();
  }
});

adminRouter.delete("/admin/users/:username", async (request, response) => {
  const username = typeof request.params.username === "string" ? request.params.username.trim() : "";
  const usernameError = validateUsername(username);

  if (usernameError) {
    return response.status(400).json({ error: "Invalid user selected." });
  }

  try {
    const result = await pool.query(`DELETE FROM app_users WHERE username = $1 RETURNING username`, [
      username,
    ]);

    if (!result.rows[0]) {
      return response.status(404).json({ error: "User not found." });
    }

    return response.json({ success: true, username: result.rows[0].username });
  } catch (error) {
    console.error("Could not delete admin user", error);
    return response.status(500).json({ error: "Could not delete user." });
  }
});


