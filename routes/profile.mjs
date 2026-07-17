import { Router } from "express";
import { pool } from "../db/pool.mjs";

export const profileRouter = Router();

profileRouter.get("/profile/:username", async (request, response) => {
  const username = typeof request.params.username === "string" ? request.params.username.trim() : "";

  if (!username) {
    return response.status(400).json({ error: "Username is required." });
  }

  try {
    const result = await pool.query(
      `SELECT u.username, u.name, u.created_at,
              (SELECT COUNT(*)::int FROM posts WHERE author_id = u.id) AS post_count,
              (SELECT COUNT(*)::int FROM connections
               WHERE status = 'accepted' AND (user_low_id = u.id OR user_high_id = u.id)) AS connection_count
       FROM app_users u
       WHERE u.username = $1`,
      [username],
    );

    const user = result.rows[0];
    if (!user) {
      return response.status(404).json({ error: "User not found." });
    }

    return response.json({
      success: true,
      profile: {
        username: user.username,
        name: user.name,
        memberSince: user.created_at,
        postCount: user.post_count,
        connectionCount: user.connection_count,
      },
    });
  } catch (error) {
    console.error("Could not load profile", error);
    return response.status(500).json({ error: "Could not load profile." });
  }
});
