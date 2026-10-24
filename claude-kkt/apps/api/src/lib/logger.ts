import pino from "pino";
import { config } from "../config.js";

/** Structured JSON logger (pretty in dev). Secrets are redacted by path. */
export const logger = pino({
  level: config.LOG_LEVEL,
  redact: { paths: ["req.headers.authorization", "req.headers.cookie", "*.password", "*.password_hash", "*.token", "*.refresh_token"], censor: "[redacted]" },
  ...(config.LOG_PRETTY ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss" } } } : {}),
  base: { service: "kkt-api" },
});
