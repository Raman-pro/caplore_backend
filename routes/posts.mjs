import { Router } from "express";
import { pool } from "../db/pool.mjs";
import { publicUrlForObjectKey } from "../lib/s3.mjs";
import { canViewPost, parsePositiveInt } from "../lib/community-helpers.mjs";
import { parsePostBody, parseCommentBody } from "../lib/validation.mjs";

export const postsRouter = Router();

postsRouter.post("/posts", async (request, response) => {
  const parsed = parsePostBody(request.body ?? {});
  if (parsed.error) {
    return response.status(400).json({ error: parsed.error });
  }

  const ownedPrefix = `posts/${request.userId}/`;
  if (parsed.value.imageKeys.some((key) => !key.startsWith(ownedPrefix))) {
    return response.status(400).json({ error: "Invalid image selection." });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const postResult = await client.query(
      `INSERT INTO posts (author_id, body, category) VALUES ($1, $2, $3) RETURNING id, created_at`,
      [request.userId, parsed.value.body, parsed.value.category],
    );
    const postId = postResult.rows[0].id;

    for (const [index, objectKey] of parsed.value.imageKeys.entries()) {
      await client.query(
        `INSERT INTO post_images (post_id, object_key, position) VALUES ($1, $2, $3)`,
        [postId, objectKey, index],
      );
    }

    await client.query("COMMIT");

    const userResult = await pool.query(
      `SELECT u.username, u.name
       FROM app_users u
       WHERE u.id = $1`,
      [request.userId]
    );
    const images = parsed.value.imageKeys.map((key, index) => ({ id: index, url: publicUrlForObjectKey(key) }));

    return response.status(201).json({
      success: true,
      post: {
        id: Number(postId),
        authorUsername: userResult.rows[0].username,
        authorName: userResult.rows[0].name,
        body: parsed.value.body,
        category: parsed.value.category,
        createdAt: postResult.rows[0].created_at,
        images,
        likeCount: 0,
        commentCount: 0,
        likedByMe: false,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Could not create post", error);
    return response.status(500).json({ error: "Could not create the post." });
  } finally {
    client.release();
  }
});

postsRouter.post("/posts/:id/like", async (request, response) => {
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
      `INSERT INTO likes (post_id, user_id) VALUES ($1, $2) ON CONFLICT (post_id, user_id) DO NOTHING RETURNING id`,
      [postId, request.userId],
    );

    let liked;
    if (insertResult.rows.length) {
      liked = true;
    } else {
      await pool.query(`DELETE FROM likes WHERE post_id = $1 AND user_id = $2`, [postId, request.userId]);
      liked = false;
    }

    const countResult = await pool.query(`SELECT COUNT(*)::int AS count FROM likes WHERE post_id = $1`, [postId]);

    return response.json({ success: true, liked, likeCount: countResult.rows[0].count });
  } catch (error) {
    console.error("Could not toggle like", error);
    return response.status(500).json({ error: "Could not update like." });
  }
});

postsRouter.post("/posts/:id/comments", async (request, response) => {
  const postId = parsePositiveInt(request.params.id);
  if (!postId) {
    return response.status(400).json({ error: "Invalid post id." });
  }

  const parsed = parseCommentBody(request.body ?? {});
  if (parsed.error) {
    return response.status(400).json({ error: parsed.error });
  }

  try {
    const visible = await canViewPost(request.userId, postId);
    if (!visible) {
      return response.status(404).json({ error: "Post not found." });
    }

    const insertResult = await pool.query(
      `INSERT INTO comments (post_id, author_id, body) VALUES ($1, $2, $3) RETURNING id, created_at`,
      [postId, request.userId, parsed.value.body],
    );
    const userResult = await pool.query(
      `SELECT u.username, u.name
       FROM app_users u
       WHERE u.id = $1`,
      [request.userId]
    );

    return response.status(201).json({
      success: true,
      comment: {
        id: Number(insertResult.rows[0].id),
        authorUsername: request.username,
        authorName: userResult.rows[0]?.name ?? request.username,
        body: parsed.value.body,
        createdAt: insertResult.rows[0].created_at,
      },
    });
  } catch (error) {
    console.error("Could not create comment", error);
    return response.status(500).json({ error: "Could not add comment." });
  }
});

postsRouter.get("/posts/:id/comments", async (request, response) => {
  const postId = parsePositiveInt(request.params.id);
  if (!postId) {
    return response.status(400).json({ error: "Invalid post id." });
  }

  try {
    const visible = await canViewPost(request.userId, postId);
    if (!visible) {
      return response.status(404).json({ error: "Post not found." });
    }

    const result = await pool.query(
      `SELECT c.id, c.body, c.created_at, u.username, u.name
       FROM comments c
       JOIN app_users u ON u.id = c.author_id
       WHERE c.post_id = $1
       ORDER BY c.created_at ASC`,
      [postId],
    );

    return response.json({
      success: true,
      comments: result.rows.map((row) => ({
        id: Number(row.id),
        authorUsername: row.username,
        authorName: row.name,
        body: row.body,
        createdAt: row.created_at,
      })),
    });
  } catch (error) {
    console.error("Could not load comments", error);
    return response.status(500).json({ error: "Could not load comments." });
  }
});
