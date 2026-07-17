import { isSupportedImageContentType } from "./s3.mjs";

export function parseSubmission(body) {
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

export function parseLoginRequest(body) {
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

export function parsePostBody(body) {
  const text = typeof body.body === "string" ? body.body.trim() : "";
  const imageKeys = Array.isArray(body.imageKeys) ? body.imageKeys : [];
  const category = typeof body.category === "string" ? body.category.trim() : "";

  const VALID_CATEGORIES = ["deal_insight", "market_update", "question"];
  if (!VALID_CATEGORIES.includes(category)) {
    return { error: "Category must be 'deal_insight', 'market_update', or 'question'." };
  }

  if (text.length < 1 || text.length > 4000) {
    return { error: "Post text must be between 1 and 4000 characters." };
  }

  if (
    imageKeys.length > 6 ||
    imageKeys.some((key) => typeof key !== "string" || !key.startsWith("posts/"))
  ) {
    return { error: "Invalid image selection." };
  }

  return { value: { body: text, imageKeys, category } };
}

export function parseCommentBody(body) {
  const text = typeof body.body === "string" ? body.body.trim() : "";

  if (text.length < 1 || text.length > 1200) {
    return { error: "Comment must be between 1 and 1200 characters." };
  }

  return { value: { body: text } };
}

export function parsePresignRequest(body) {
  const files = Array.isArray(body.files) ? body.files : [];

  if (files.length < 1 || files.length > 6) {
    return { error: "Select between 1 and 6 images." };
  }

  const parsed = [];
  for (const file of files) {
    const contentType = typeof file?.contentType === "string" ? file.contentType : "";
    const fileName = typeof file?.fileName === "string" ? file.fileName.slice(0, 200) : "";

    if (!isSupportedImageContentType(contentType)) {
      return { error: "Images must be JPEG, PNG, WEBP, or GIF." };
    }

    parsed.push({ contentType, fileName });
  }

  return { value: { files: parsed } };
}

export function parseConnectionRequest(body) {
  const receiverUsername =
    typeof body.receiverUsername === "string" ? body.receiverUsername.trim() : "";

  if (!receiverUsername) {
    return { error: "receiverUsername is required." };
  }

  return { value: { receiverUsername } };
}

export function parseConnectionResponse(body) {
  const status = body.status;

  if (status !== "accepted" && status !== "rejected") {
    return { error: "status must be 'accepted' or 'rejected'." };
  }

  return { value: { status } };
}
