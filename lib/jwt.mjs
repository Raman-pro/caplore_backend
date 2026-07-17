import jwt from "jsonwebtoken";
import { config } from "./config.mjs";

export function signToken(user) {
  return jwt.sign({ sub: String(user.id), username: user.username }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}
