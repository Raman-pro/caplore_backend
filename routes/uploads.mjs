import { Router } from "express";
import { createPresignedUpload } from "../lib/s3.mjs";
import { parsePresignRequest } from "../lib/validation.mjs";

export const uploadsRouter = Router();

uploadsRouter.post("/uploads/presign", async (request, response) => {
  const parsed = parsePresignRequest(request.body ?? {});
  if (parsed.error) {
    return response.status(400).json({ error: parsed.error });
  }

  try {
    const uploads = await Promise.all(
      parsed.value.files.map((file) =>
        createPresignedUpload({ userId: request.userId, contentType: file.contentType }),
      ),
    );

    return response.json({ success: true, uploads });
  } catch (error) {
    console.error("Could not create presigned upload", error);
    return response
      .status(500)
      .json({ error: "Could not prepare image upload. Please try again." });
  }
});
