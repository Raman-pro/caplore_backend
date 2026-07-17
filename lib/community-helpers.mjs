import { pool } from "../db/pool.mjs";

export async function getAcceptedPeerIds(userId) {
  const result = await pool.query(
    `SELECT CASE WHEN user_low_id = $1 THEN user_high_id ELSE user_low_id END AS peer_id
     FROM connections
     WHERE status = 'accepted' AND (user_low_id = $1 OR user_high_id = $1)`,
    [userId],
  );
  return result.rows.map((row) => Number(row.peer_id));
}

export async function canViewPost(userId, postId) {
  const result = await pool.query(`SELECT author_id FROM posts WHERE id = $1`, [postId]);
  const post = result.rows[0];
  if (!post) return false;

  const authorId = Number(post.author_id);
  if (authorId === userId) return true;

  const peerIds = await getAcceptedPeerIds(userId);
  return peerIds.includes(authorId);
}

export function parsePositiveInt(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
