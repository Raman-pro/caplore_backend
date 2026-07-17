import { Router } from "express";
import { pool } from "../db/pool.mjs";
import { parsePositiveInt } from "../lib/community-helpers.mjs";
import { parseConnectionRequest, parseConnectionResponse } from "../lib/validation.mjs";

export const connectionsRouter = Router();

connectionsRouter.post("/connections", async (request, response) => {
  const parsed = parseConnectionRequest(request.body ?? {});
  if (parsed.error) {
    return response.status(400).json({ error: parsed.error });
  }

  if (parsed.value.receiverUsername === request.username) {
    return response.status(400).json({ error: "You cannot connect with yourself." });
  }

  try {
    const receiverResult = await pool.query(
      `SELECT id, username, name FROM app_users WHERE username = $1`,
      [parsed.value.receiverUsername],
    );
    const receiver = receiverResult.rows[0];

    if (!receiver) {
      return response.status(404).json({ error: "User not found." });
    }

    const receiverId = Number(receiver.id);
    const lowId = Math.min(request.userId, receiverId);
    const highId = Math.max(request.userId, receiverId);

    const existing = await pool.query(
      `SELECT id, status FROM connections WHERE user_low_id = $1 AND user_high_id = $2`,
      [lowId, highId],
    );

    if (existing.rows[0] && existing.rows[0].status !== "rejected") {
      return response.status(409).json({ error: "A connection already exists with this user." });
    }

    let row;
    if (existing.rows[0]) {
      const updateResult = await pool.query(
        `UPDATE connections SET requester_id = $1, status = 'pending', responded_at = NULL, created_at = NOW()
         WHERE id = $2 RETURNING id, status, created_at`,
        [request.userId, existing.rows[0].id],
      );
      row = updateResult.rows[0];
    } else {
      const insertResult = await pool.query(
        `INSERT INTO connections (user_low_id, user_high_id, requester_id, status)
         VALUES ($1, $2, $3, 'pending') RETURNING id, status, created_at`,
        [lowId, highId, request.userId],
      );
      row = insertResult.rows[0];
    }

    return response.status(201).json({
      success: true,
      connection: {
        id: Number(row.id),
        status: row.status,
        createdAt: row.created_at,
        otherUser: { username: receiver.username, name: receiver.name },
      },
    });
  } catch (error) {
    console.error("Could not create connection request", error);
    return response.status(500).json({ error: "Could not send connection request." });
  }
});

connectionsRouter.post("/connections/:id/respond", async (request, response) => {
  const parsed = parseConnectionResponse(request.body ?? {});
  if (parsed.error) {
    return response.status(400).json({ error: parsed.error });
  }

  const connectionId = parsePositiveInt(request.params.id);
  if (!connectionId) {
    return response.status(400).json({ error: "Invalid connection id." });
  }

  try {
    const existing = await pool.query(
      `SELECT id, user_low_id, user_high_id, requester_id, status FROM connections WHERE id = $1`,
      [connectionId],
    );
    const connection = existing.rows[0];

    if (
      !connection ||
      (Number(connection.user_low_id) !== request.userId && Number(connection.user_high_id) !== request.userId)
    ) {
      return response.status(404).json({ error: "Connection request not found." });
    }

    if (Number(connection.requester_id) === request.userId) {
      return response.status(403).json({ error: "You cannot respond to your own request." });
    }

    if (connection.status !== "pending") {
      return response.status(409).json({ error: "This request has already been responded to." });
    }

    const updateResult = await pool.query(
      `UPDATE connections SET status = $1, responded_at = NOW() WHERE id = $2 RETURNING id, status`,
      [parsed.value.status, connectionId],
    );

    return response.json({
      success: true,
      connection: { id: Number(updateResult.rows[0].id), status: updateResult.rows[0].status },
    });
  } catch (error) {
    console.error("Could not respond to connection request", error);
    return response.status(500).json({ error: "Could not update the connection request." });
  }
});

connectionsRouter.get("/connections", async (request, response) => {
  try {
    const result = await pool.query(
      `SELECT u.username, u.name, c.responded_at AS connected_since
       FROM connections c
       JOIN app_users u ON u.id = CASE WHEN c.user_low_id = $1 THEN c.user_high_id ELSE c.user_low_id END
       WHERE c.status = 'accepted' AND (c.user_low_id = $1 OR c.user_high_id = $1)
       ORDER BY c.responded_at DESC`,
      [request.userId],
    );

    return response.json({
      success: true,
      connections: result.rows.map((row) => ({
        username: row.username,
        name: row.name,
        connectedSince: row.connected_since,
      })),
    });
  } catch (error) {
    console.error("Could not load connections", error);
    return response.status(500).json({ error: "Could not load connections." });
  }
});

connectionsRouter.get("/connections/requests", async (request, response) => {
  try {
    const result = await pool.query(
      `SELECT c.id, c.created_at, u.username, u.name
       FROM connections c
       JOIN app_users u ON u.id = c.requester_id
       WHERE c.status = 'pending' AND c.requester_id != $1 AND (c.user_low_id = $1 OR c.user_high_id = $1)
       ORDER BY c.created_at DESC`,
      [request.userId],
    );

    return response.json({
      success: true,
      requests: result.rows.map((row) => ({
        id: Number(row.id),
        createdAt: row.created_at,
        fromUser: { username: row.username, name: row.name },
      })),
    });
  } catch (error) {
    console.error("Could not load connection requests", error);
    return response.status(500).json({ error: "Could not load connection requests." });
  }
});

connectionsRouter.get("/connections/suggestions", async (request, response) => {
  try {
    const result = await pool.query(
      `SELECT username, name FROM app_users
       WHERE id != $1
         AND id NOT IN (
           SELECT CASE WHEN user_low_id = $1 THEN user_high_id ELSE user_low_id END
           FROM connections
           WHERE (user_low_id = $1 OR user_high_id = $1) AND status IN ('pending', 'accepted')
         )
       ORDER BY created_at DESC
       LIMIT 20`,
      [request.userId],
    );

    return response.json({ success: true, suggestions: result.rows });
  } catch (error) {
    console.error("Could not load suggestions", error);
    return response.status(500).json({ error: "Could not load suggestions." });
  }
});
