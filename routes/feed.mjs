import { Router } from "express";
import { pool } from "../db/pool.mjs";
import { publicUrlForObjectKey } from "../lib/s3.mjs";
import { getAcceptedPeerIds } from "../lib/community-helpers.mjs";

export const feedRouter = Router();

async function attachImages(rows) {
  const postIds = rows.map((row) => row.id);
  const imagesResult = await pool.query(
    `SELECT id, post_id, object_key
     FROM post_images
     WHERE post_id = ANY($1::bigint[])
     ORDER BY post_id, position ASC, id ASC`,
    [postIds],
  );

  const imagesByPost = new Map();
  for (const image of imagesResult.rows) {
    const key = String(image.post_id);
    const list = imagesByPost.get(key) ?? [];
    list.push({ id: Number(image.id), url: publicUrlForObjectKey(image.object_key) });
    imagesByPost.set(key, list);
  }

  return rows.map((row) => ({
    id: Number(row.id),
    authorUsername: row.author_username,
    authorName: row.author_name,
    body: row.body,
    category: row.category,
    createdAt: row.created_at,
    images: imagesByPost.get(String(row.id)) ?? [],
    likeCount: Number(row.like_count),
    commentCount: Number(row.comment_count),
    likedByMe: row.liked_by_me,
  }));
}

feedRouter.get("/feed", async (request, response) => {
  const limit = Math.min(Math.max(Number.parseInt(request.query.limit, 10) || 20, 1), 50);
  const before = typeof request.query.before === "string" ? request.query.before : null;
  const category = typeof request.query.category === "string" ? request.query.category.trim() : null;

  const VALID_CATEGORIES = ["deal_insight", "market_update", "question"];
  if (category && !VALID_CATEGORIES.includes(category)) {
    return response.status(400).json({ error: "Invalid category filter." });
  }

  try {
    const peerIds = await getAcceptedPeerIds(request.userId);
    const authorIds = [request.userId, ...peerIds];

    let query = `
      SELECT p.id, p.body, p.category, p.created_at, u.username AS author_username, u.name AS author_name,
              COALESCE(l.like_count, 0) AS like_count,
              COALESCE(c.comment_count, 0) AS comment_count,
              EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = $2) AS liked_by_me
       FROM posts p
       JOIN app_users u ON u.id = p.author_id
       LEFT JOIN (SELECT post_id, COUNT(*) AS like_count FROM likes GROUP BY post_id) l ON l.post_id = p.id
       LEFT JOIN (SELECT post_id, COUNT(*) AS comment_count FROM comments GROUP BY post_id) c ON c.post_id = p.id
       WHERE p.author_id = ANY($1::bigint[])
         AND ($3::timestamptz IS NULL OR p.created_at < $3::timestamptz)
    `;

    const params = [authorIds, request.userId, before];

    if (category) {
      query += ` AND p.category = $4`;
      params.push(category);
    }

    query += ` ORDER BY p.created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(query, params);

    const posts = result.rows.length ? await attachImages(result.rows) : [];
    const nextCursor = posts.length === limit ? posts[posts.length - 1].createdAt : null;

    return response.json({ success: true, posts, nextCursor });
  } catch (error) {
    console.error("Could not load feed", error);
    return response.status(500).json({ error: "Could not load the feed." });
  }
});
