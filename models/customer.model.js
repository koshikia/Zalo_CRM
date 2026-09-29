import db from "../config/database.js";

export async function upsertCustomer({
  zaloAccountId,
  zaloUserId,
  displayName,
  phone
}) {
  if (!zaloAccountId) throw new Error("zaloAccountId is required");
  if (!zaloUserId) throw new Error("zaloUserId is required");

  const [result] = await db.execute(
    `INSERT INTO customers (
       zalo_account_id,
       zalo_user_id,
       display_name,
       phone,
       first_interaction_at,
       last_interaction_at
     )
     VALUES (?, ?, ?, ?, NOW(), NOW())
     ON DUPLICATE KEY UPDATE
       display_name = COALESCE(VALUES(display_name), display_name),
       phone = COALESCE(VALUES(phone), phone),
       last_interaction_at = NOW()`,
    [
      zaloAccountId,
      String(zaloUserId),
      displayName || null,
      phone || null
    ]
  );

  return result;
}

export function normalizeUserInfo(raw) {
  console.log("[normalizeUserInfo] raw =", JSON.stringify(raw, null, 2));

  let profile = null;

  if (raw?.changed_profiles && typeof raw.changed_profiles === "object") {
    const profiles = Object.values(raw.changed_profiles);
    if (profiles.length > 0) profile = profiles[0];
  }

  if (!profile && raw?.userId) profile = raw;

  if (!profile) {
    console.log("[normalizeUserInfo] Không tìm thấy profile");
    return { zaloUserId: null, displayName: null, phone: null };
  }

  const result = {
    zaloUserId: profile.userId ?? profile.userKey ?? null,
    displayName:
      profile.displayName ?? profile.zaloName ?? profile.username ?? null,
    phone: profile.phoneNumber || null
  };

  console.log("[normalizeUserInfo] profile =", profile);
  console.log("[normalizeUserInfo] result =", result);

  return result;
}

export async function countByAccount(accountId) {
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS total
     FROM customers
     WHERE zalo_account_id=?`,
    [accountId]
  );
  return Number(row.total);
}

export async function countTodayByAccount(accountId) {
  const [[row]] = await db.query(
    `SELECT COUNT(*) AS total
     FROM customers
     WHERE zalo_account_id=?
       AND DATE(first_interaction_at)=CURDATE()`,
    [accountId]
  );
  return Number(row.total);
}

export async function findRecentByAccount(accountId, limit = 100) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 500));

  const [rows] = await db.query(
    `SELECT id, zalo_user_id, display_name, phone,
            first_interaction_at, last_interaction_at
     FROM customers
     WHERE zalo_account_id=?
     ORDER BY last_interaction_at DESC
     LIMIT ${safeLimit}`,
    [accountId]
  );

  return rows;
}
