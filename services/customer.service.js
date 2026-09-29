import db from "../config/database.js";

function pick(obj, keys) {
    for (const key of keys) {
        if (
            obj &&
            obj[key] !== undefined &&
            obj[key] !== null &&
            obj[key] !== ""
        ) {
            return obj[key];
        }
    }

    return null;
}

export async function upsertCustomer({
    zaloAccountId,
    zaloUserId,
    displayName,
    phone
}) {
    if (!zaloAccountId) {
        throw new Error("zaloAccountId is required");
    }

    if (!zaloUserId) {
        throw new Error("zaloUserId is required");
    }

    const [result] = await db.execute(
        `
        INSERT INTO customers (
            zalo_account_id,
            zalo_user_id,
            display_name,
            phone,
            first_interaction_at,
            last_interaction_at
        )
        VALUES (?, ?, ?, ?, NOW(), NOW())

        ON DUPLICATE KEY UPDATE
            display_name = COALESCE(
                VALUES(display_name),
                display_name
            ),

            phone = COALESCE(
                VALUES(phone),
                phone
            ),

            last_interaction_at = NOW()
        `,
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

  // Trường hợp getUserInfo trả về changed_profiles
  if (raw?.changed_profiles && typeof raw.changed_profiles === "object") {
    const profiles = Object.values(raw.changed_profiles);

    if (profiles.length > 0) {
      profile = profiles[0];
    }
  }

  // Một số trường hợp API có thể trả trực tiếp profile
  if (!profile && raw?.userId) {
    profile = raw;
  }

  if (!profile) {
    console.log("[normalizeUserInfo] Không tìm thấy profile");
    return {
      zaloUserId: null,
      displayName: null,
      phone: null,
    };
  }

  const result = {
    zaloUserId: profile.userId ?? profile.userKey ?? null,

    displayName:
      profile.displayName ??
      profile.zaloName ??
      profile.username ??
      null,

    phone:
      profile.phoneNumber ||
      null,
  };

  console.log("[normalizeUserInfo] profile =", profile);
  console.log("[normalizeUserInfo] result =", result);

  return result;
}
