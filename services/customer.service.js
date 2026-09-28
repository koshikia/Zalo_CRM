import db from "../config/database.js";

function pick(obj, keys) {
  for (const key of keys) {
    if (obj && obj[key] !== undefined && obj[key] !== null && obj[key] !== "") {
      return obj[key];
    }
  }
  return null;
}

export async function upsertCustomer({
  zaloAccountId,
  zaloUserId,
  displayName,
  phone,
  avatarUrl
}) {
  const sql = `
    INSERT INTO customers (
      zalo_account_id,
      zalo_user_id,
      display_name,
      phone,
      avatar_url,
      first_interaction_at,
      last_interaction_at
    )
    VALUES (?, ?, ?, ?, ?, NOW(), NOW())
    ON DUPLICATE KEY UPDATE
      display_name = COALESCE(VALUES(display_name), display_name),
      phone = COALESCE(VALUES(phone), phone),
      avatar_url = COALESCE(VALUES(avatar_url), avatar_url),
      last_interaction_at = NOW()
  `;

  await db.execute(sql, [
    zaloAccountId,
    String(zaloUserId),
    displayName,
    phone,
    avatarUrl
  ]);
}

export function normalizeUserInfo(raw) {
  const data = raw?.data ?? raw?.profile ?? raw?.user ?? raw ?? {};

  return {
    zaloUserId: pick(data, ["userId", "user_id", "id"]),
    displayName: pick(data, ["displayName", "display_name", "name", "zaloName"]),
    phone: pick(data, ["phone", "phoneNumber", "phone_number"]),
    avatarUrl: pick(data, ["avatar", "avatarUrl", "avatar_url"])
  };
}
