export const DEMO_PORT = parseInt(process.env.DEMO_PORT ?? "3005", 10);
export const FEED_URL = (process.env.FEED_URL ?? "http://127.0.0.1:3002").replace(/\/$/, "");
export const MITL_URL = (process.env.MITL_URL ?? "http://127.0.0.1:3001").replace(/\/$/, "");
