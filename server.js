import "dotenv/config";
import express from "express";
import cookieSession from "cookie-session";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import db, { pingDatabase } from "./config/database.js";
import zaloRoutes from "./routes/zalo.routes.js";
import dashboardRoutes from "./routes/dashboard.routes.js";
import { requireAuth } from "./middleware/auth.middleware.js";
import zaloSession from "./services/zalo-session.service.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3000);

fs.mkdirSync(path.join(__dirname, "storage", "qr"), { recursive: true });

app.use(express.json());

app.use(cookieSession({
  name: "zalo_crm_session",
  keys: [process.env.SESSION_SECRET || "dev-only-change-me"],
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 1000 * 60 * 60 * 24 * 30
}));

app.use(express.static(path.join(__dirname, "public")));
app.use("/storage", express.static(path.join(__dirname, "storage")));
app.use("/api/zalo", zaloRoutes);
app.use("/api/dashboard", requireAuth, dashboardRoutes);

app.get("/dashboard", (req, res) => {
  if (!req.session?.accountId) return res.redirect("/");
  res.sendFile(path.join(__dirname, "public", "dashboard.html"));
});

app.get("/", (req, res) => {
  if (req.session?.accountId) return res.redirect("/dashboard");
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).json({ message: "Internal server error" });
});

async function start() {
  await pingDatabase();
  await zaloSession.restoreAll();

  app.listen(PORT, () => {
    console.log(`Zalo CRM running: http://localhost:${PORT}`);
  });
}

start().catch((error) => {
  console.error("Startup failed:", error);
  process.exit(1);
});
