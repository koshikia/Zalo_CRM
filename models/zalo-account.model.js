import db from "../config/database.js";

const SELECT_FIELDS = `
  id, user_id, zalo_user_id, zalo_name, status, last_connected_at
`;

export async function findById(id) {
  const [rows] = await db.execute(
    `SELECT ${SELECT_FIELDS} FROM zalo_accounts WHERE id=?`,
    [id]
  );
  return rows[0] || null;
}

export async function findLatestConnected() {
  const [rows] = await db.query(`
    SELECT ${SELECT_FIELDS}
    FROM zalo_accounts
    WHERE status='CONNECTED'
    ORDER BY last_connected_at DESC
    LIMIT 1
  `);
  return rows[0] || null;
}

export async function findRestorableAccounts() {
  const [rows] = await db.query(`
    SELECT id, user_id, zalo_user_id, zalo_name, credential_ciphertext
    FROM zalo_accounts
    WHERE credential_ciphertext IS NOT NULL
  `);
  return rows;
}

export async function createOrUpdateConnected({
  userId,
  zaloUserId,
  zaloName,
  credentialCiphertext
}) {
  const [result] = await db.execute(
    `INSERT INTO zalo_accounts
       (user_id, zalo_user_id, zalo_name, credential_ciphertext,
        status, last_connected_at, last_error)
     VALUES (?, ?, ?, ?, 'CONNECTED', NOW(), NULL)
     ON DUPLICATE KEY UPDATE
       user_id=VALUES(user_id),
       zalo_name=VALUES(zalo_name),
       credential_ciphertext=VALUES(credential_ciphertext),
       status='CONNECTED',
       last_connected_at=NOW(),
       last_error=NULL`,
    [userId, zaloUserId, zaloName, credentialCiphertext]
  );

  if (result.insertId) return result.insertId;

  const [rows] = await db.execute(
    `SELECT id FROM zalo_accounts WHERE zalo_user_id=?`,
    [zaloUserId]
  );

  if (!rows.length) throw new Error("Không tìm thấy tài khoản Zalo sau khi lưu");
  return rows[0].id;
}

export async function markStatus(id, status, lastError = null) {
  await db.execute(
    `UPDATE zalo_accounts
     SET status=?, last_error=?
     WHERE id=?`,
    [status, lastError, id]
  );
}

export async function markConnected(id, zaloUserId, zaloName) {
  await db.execute(
    `UPDATE zalo_accounts
     SET status='CONNECTED', zalo_user_id=?, zalo_name=?,
         last_connected_at=NOW(), last_error=NULL
     WHERE id=?`,
    [zaloUserId, zaloName, id]
  );
}
