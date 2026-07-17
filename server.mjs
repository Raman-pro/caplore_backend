import { config } from "./lib/config.mjs";
import express from "express";
import { Router } from "express";
import { pool } from "./db/pool.mjs";
import { initializeDatabase } from "./db/schema.mjs";
import { corsMiddleware } from "./middleware/cors.mjs";
import { requireAuth } from "./middleware/auth.mjs";
import { miscRouter } from "./routes/misc.mjs";
import { authRouter } from "./routes/auth.mjs";
import { adminRouter } from "./routes/admin.mjs";
import { feedRouter } from "./routes/feed.mjs";
import { postsRouter } from "./routes/posts.mjs";
import { connectionsRouter } from "./routes/connections.mjs";
import { uploadsRouter } from "./routes/uploads.mjs";
import { bookmarksRouter } from "./routes/bookmarks.mjs";
import { profileRouter } from "./routes/profile.mjs";

const app = express();
app.disable("x-powered-by");
app.use("/api", corsMiddleware);
app.use(express.json({ limit: "64kb" }));
app.use(express.urlencoded({ extended: false, limit: "64kb" }));

app.use("/api", miscRouter);
app.use("/api", authRouter);
app.use("/api", adminRouter);
app.use("/api", profileRouter);

const communityRouter = Router();
communityRouter.use(requireAuth);
communityRouter.use(feedRouter);
communityRouter.use(postsRouter);
communityRouter.use(connectionsRouter);
communityRouter.use(uploadsRouter);
communityRouter.use(bookmarksRouter);

app.use("/api/community", communityRouter);

app.use("/api", (_request, response) => {
  response.status(404).json({ error: "Not found." });
});

async function start() {
  try {
    await initializeDatabase();
    app.listen(config.port, "0.0.0.0", () => {
      console.log(`Server listening on port ${config.port}`);
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
