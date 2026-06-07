/// <reference types="astro/client" />

export type Env = {
  DB: D1Database;
  CACHE: KVNamespace;
  SESSION: KVNamespace;
  MEDIA: R2Bucket;
  BACKUPS: R2Bucket;
  TINIFY_API_KEY: string;
  UDDOKTAPAY_API_KEY: string;
  UDDOKTAPAY_BASE_URL: string;
  FRAUDBD_API_KEY: string;
  DEEPSEEK_API_KEY: string;
  OPENAI_API_KEY: string;
  SESSION_SECRET: string;
  PASSWORD_PEPPER: string;
  PUBLIC_SITE_URL: string;
  PUBLIC_SITE_NAME: string;
};

declare namespace App {
  interface Locals {
    cfContext: ExecutionContext;
  }
}
