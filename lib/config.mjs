import "dotenv/config";

const required = ["DATABASE_URL", "JWT_SECRET"];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`${key} is required`);
    process.exit(1);
  }
}

export const config = {
  port: Number(process.env.PORT) || 3000,
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
  adminApiKey: process.env.ADMIN_API_KEY,
  allowedOrigins: process.env.ALLOWED_ORIGINS,
  r2: {
    endpoint: process.env.R2_ENDPOINT,
    bucket: process.env.R2_BUCKET,
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    publicBaseUrl: (process.env.R2_PUBLIC_BASE_URL ?? "").replace(/\/$/, ""),
  },
};
