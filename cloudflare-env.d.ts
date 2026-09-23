declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    JWT_SECRET?: string;
    DEV_SEED_ADMIN?: string;
  }
}
