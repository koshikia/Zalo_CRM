import db from "../config/database.js";

export async function findOrCreateByZalo(zaloUserId, displayName = null) {
  const username = `zalo:${zaloUserId}`;

  const [result] = await db.execute(
    `INSERT INTO users (username, display_name)
     VALUES (?, ?)
     ON DUPLICATE KEY UPDATE
       display_name = COALESCE(VALUES(display_name), display_name)`,
    [username, displayName]
  );

  if (result.insertId) return result.insertId;

  const [rows] = await db.execute(
    `SELECT id FROM users WHERE username=?`,
    [username]
  );

  if (!rows.length) throw new Error("Không tìm thấy user sau khi tạo/cập nhật");
  return rows[0].id;
}
