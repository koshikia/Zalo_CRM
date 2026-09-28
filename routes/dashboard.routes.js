import express from "express";
import db from "../config/database.js";

const router = express.Router();

router.get("/stats", async (req, res) => {
  const accountId = req.session.accountId;
  if (!accountId) return res.status(401).json({ message: "Unauthorized" });

  const [[customers]] = await db.query(
    `SELECT COUNT(*) AS total FROM customers WHERE zalo_account_id=?`,
    [accountId]
  );

  const [[today]] = await db.query(
    `SELECT COUNT(*) AS total
     FROM customers
     WHERE zalo_account_id=? AND DATE(first_interaction_at)=CURDATE()`,
    [accountId]
  );

  const [[account]] = await db.query(
    `SELECT id, zalo_user_id, zalo_name, status, last_connected_at
     FROM zalo_accounts WHERE id=?`,
    [accountId]
  );

  res.json({
    totalCustomers: Number(customers.total),
    customersToday: Number(today.total),
    account
  });
});

router.get("/customers", async (req, res) => {
  const accountId = req.session.accountId;
  if (!accountId) return res.status(401).json({ message: "Unauthorized" });

  const [rows] = await db.query(
    `SELECT id, zalo_user_id, display_name, phone, avatar_url,
            first_interaction_at, last_interaction_at
     FROM customers
     WHERE zalo_account_id=?
     ORDER BY last_interaction_at DESC
     LIMIT 100`,
    [accountId]
  );

  res.json(rows);
});

export default router;
