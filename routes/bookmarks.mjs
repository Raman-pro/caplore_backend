import { Router } from "express";
import { pool } from "../db/pool.mjs";
import { publicUrlForObjectKey } from "../lib/s3.mjs";
import { canViewPost, getAcceptedPeerIds, parsePositiveInt } from "../lib/community-helpers.mjs";

export const bookmarksRouter = Router();

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
    createdAt: row.post_created_at,
    bookmarkedAt: row.bookmarked_at,
    images: imagesByPost.get(String(row.id)) ?? [],
    likeCount: Number(row.like_count),
    commentCount: Number(row.comment_count),
    likedByMe: row.liked_by_me,
    bookmarkedByMe: true,
  }));
}

bookmarksRouter.post("/posts/:id/bookmark", async (request, response) => {
  const postId = parsePositiveInt(request.params.id);
  if (!postId) {
    return response.status(400).json({ error: "Invalid post id." });
  }

  try {
    const visible = await canViewPost(request.userId, postId);
    if (!visible) {
      return response.status(404).json({ error: "Post not found." });
    }

    const insertResult = await pool.query(
      `INSERT INTO bookmarks (post_id, user_id) VALUES ($1, $2) ON CONFLICT (post_id, user_id) DO NOTHING RETURNING id`,
      [postId, request.userId],
    );

    let bookmarked;
    if (insertResult.rows.length) {
      bookmarked = true;
    } else {
      await pool.query(`DELETE FROM bookmarks WHERE post_id = $1 AND user_id = $2`, [postId, request.userId]);
      bookmarked = false;
    }

    const countResult = await pool.query(`SELECT COUNT(*)::int AS count FROM bookmarks WHERE post_id = $1`, [postId]);

    return response.json({ success: true, bookmarked, bookmarkCount: countResult.rows[0].count });
  } catch (error) {
    console.error("Could not toggle bookmark", error);
    return response.status(500).json({ error: "Could not update bookmark." });
  }
});

bookmarksRouter.get("/bookmarks", async (request, response) => {
  const limit = Math.min(Math.max(Number.parseInt(request.query.limit, 10) || 20, 1), 50);
  const before = typeof request.query.before === "string" ? request.query.before : null;

  try {
    const peerIds = await getAcceptedPeerIds(request.userId);
    const authorIds = [request.userId, ...peerIds];

    const result = await pool.query(
      `SELECT p.id, p.body, p.category, p.created_at AS post_created_at, b.created_at AS bookmarked_at,
              u.username AS author_username, u.name AS author_name,
              COALESCE(l.like_count, 0) AS like_count,
              COALESCE(c.comment_count, 0) AS comment_count,
              EXISTS(SELECT 1 FROM likes WHERE post_id = p.id AND user_id = $2) AS liked_by_me
       FROM bookmarks b
       JOIN posts p ON p.id = b.post_id
       JOIN app_users u ON u.id = p.author_id
       LEFT JOIN (SELECT post_id, COUNT(*) AS like_count FROM likes GROUP BY post_id) l ON l.post_id = p.id
       LEFT JOIN (SELECT post_id, COUNT(*) AS comment_count FROM comments GROUP BY post_id) c ON c.post_id = p.id
       WHERE b.user_id = $2
         AND p.author_id = ANY($1::bigint[])
         AND ($3::timestamptz IS NULL OR b.created_at < $3::timestamptz)
       ORDER BY b.created_at DESC
       LIMIT $4`,
      [authorIds, request.userId, before, limit],
    );

    const posts = result.rows.length ? await attachImages(result.rows) : [];
    const nextCursor = posts.length === limit ? posts[posts.length - 1].bookmarkedAt : null;

    return response.json({ success: true, posts, nextCursor });
  } catch (error) {
    console.error("Could not load bookmarks", error);
    return response.status(500).json({ error: "Could not load bookmarks." });
  }
});
