import db from "../config/database.js";

export async function listCampaigns(req, res) {
  try {
    const accountId = req.session.accountId;
    const [rows] = await db.execute(`
      SELECT c.id, c.name, c.content, c.status, c.scheduled_at,
             c.delay_minutes, c.interval_seconds, c.created_at,
             COUNT(cc.id) AS total_recipients,
             SUM(CASE WHEN cc.reply_status = 'REPLIED' THEN 1 ELSE 0 END) AS replied_count,
             SUM(CASE WHEN cc.view_status = 'VIEWED' THEN 1 ELSE 0 END) AS viewed_count,
             SUM(CASE WHEN cc.view_status = 'NOT_VIEWED' THEN 1 ELSE 0 END) AS not_viewed_count,
             SUM(CASE WHEN cc.view_status = 'BLOCKED' THEN 1 ELSE 0 END) AS blocked_count,
             SUM(CASE WHEN cc.send_status = 'SENT' THEN 1 ELSE 0 END) AS sent_count,
             SUM(CASE WHEN cc.send_status = 'FAILED' THEN 1 ELSE 0 END) AS failed_count
      FROM campaigns c
      LEFT JOIN campaign_customers cc ON cc.campaign_id = c.id
      WHERE c.zalo_account_id = ?
      GROUP BY c.id
      ORDER BY c.created_at DESC
    `, [accountId]);
    res.json(rows);
  } catch (error) {
    console.error("[CAMPAIGNS] list:", error);
    res.status(500).json({ message: "Không thể tải chiến dịch." });
  }
}

export async function listCampaignCustomers(req, res) {
  try {
    const accountId = req.session.accountId;
    const [rows] = await db.execute(`
      SELECT id, zalo_user_id, display_name, phone, status, last_interaction_at
      FROM customers
      WHERE zalo_account_id = ? AND status = 'ACTIVE'
      ORDER BY display_name IS NULL, display_name ASC, last_interaction_at DESC
    `, [accountId]);
    res.json(rows);
  } catch (error) {
    console.error("[CAMPAIGNS] customers:", error);
    res.status(500).json({ message: "Không thể tải khách hàng." });
  }
}

function validatePayload(body) {
  const name = String(body.name || "").trim();
  const content = String(body.content || "").trim();
  const customerIds = Array.isArray(body.customerIds)
    ? [...new Set(body.customerIds.map(Number).filter(Number.isSafeInteger))]
    : [];
  const delayMinutes = Number(body.delayMinutes ?? 0);
  const intervalSeconds = Number(body.intervalSeconds ?? 10);

  if (!name) throw new Error("Vui lòng nhập tên chiến dịch.");
  if (!content) throw new Error("Vui lòng nhập nội dung tin nhắn.");
  if (!customerIds.length) throw new Error("Hãy chọn ít nhất một khách hàng.");
  if (!Number.isInteger(delayMinutes) || delayMinutes < 0 || delayMinutes > 525600)
    throw new Error("Thời gian bắt đầu phải từ 0 đến 525600 phút.");
  if (!Number.isInteger(intervalSeconds) || intervalSeconds < 1 || intervalSeconds > 86400)
    throw new Error("Khoảng cách gửi phải từ 1 đến 86400 giây.");
  return { name, content, customerIds, delayMinutes, intervalSeconds };
}


export async function getCampaign(req, res) {
  try {
    const [rows] = await db.execute(
      `SELECT id, name, content, status, delay_minutes, interval_seconds
       FROM campaigns WHERE id = ? AND zalo_account_id = ?`,
      [Number(req.params.id), req.session.accountId]
    );
    if (!rows.length) return res.status(404).json({ message: "Không tìm thấy chiến dịch." });
    const [recipients] = await db.execute(
      "SELECT customer_id FROM campaign_customers WHERE campaign_id = ?",
      [Number(req.params.id)]
    );
    res.json({ ...rows[0], customerIds: recipients.map(row => Number(row.customer_id)) });
  } catch (error) {
    console.error("[CAMPAIGNS] get:", error);
    res.status(500).json({ message: "Không thể tải chi tiết chiến dịch." });
  }
}

export async function createCampaign(req, res) {
  const connection = await db.getConnection();
  try {
    const accountId = req.session.accountId;
    const payload = validatePayload(req.body);

    const [customerRows] = await connection.execute(
      `SELECT id FROM customers
       WHERE zalo_account_id = ? AND status = 'ACTIVE'
         AND id IN (${payload.customerIds.map(() => "?").join(",")})`,
      [accountId, ...payload.customerIds]
    );
    if (customerRows.length !== payload.customerIds.length) {
      return res.status(400).json({ message: "Danh sách khách hàng không hợp lệ hoặc có khách hàng không thuộc tài khoản Zalo này." });
    }

    await connection.beginTransaction();
    const [result] = await connection.execute(`
      INSERT INTO campaigns
        (zalo_account_id, name, content, status, scheduled_at, delay_minutes, interval_seconds)
      VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE), ?, ?)
    `, [
      accountId, payload.name, payload.content,
      payload.delayMinutes > 0 ? "SCHEDULED" : "DRAFT",
      payload.delayMinutes, payload.delayMinutes, payload.intervalSeconds
    ]);

    const values = payload.customerIds.map(id => [result.insertId, id]);
    await connection.query(
      "INSERT INTO campaign_customers (campaign_id, customer_id) VALUES ?",
      [values]
    );
    await connection.commit();
    res.status(201).json({ success: true, id: result.insertId, message: "Đã lưu chiến dịch và danh sách khách hàng." });
  } catch (error) {
    await connection.rollback().catch(() => {});
    console.error("[CAMPAIGNS] create:", error);
    res.status(400).json({ message: error.message || "Không thể tạo chiến dịch." });
  } finally {
    connection.release();
  }
}

export async function updateCampaign(req, res) {
  try {
    const accountId = req.session.accountId;
    const id = Number(req.params.id);
    const payload = validatePayload(req.body);
    const [existing] = await db.execute(
      "SELECT id, status FROM campaigns WHERE id = ? AND zalo_account_id = ?",
      [id, accountId]
    );
    if (!existing.length) return res.status(404).json({ message: "Không tìm thấy chiến dịch." });
    if (!["DRAFT", "SCHEDULED"].includes(existing[0].status))
      return res.status(409).json({ message: "Chỉ có thể sửa chiến dịch nháp hoặc đã lên lịch." });

    const [customerRows] = await db.execute(
      `SELECT id FROM customers
       WHERE zalo_account_id = ? AND status = 'ACTIVE'
         AND id IN (${payload.customerIds.map(() => "?").join(",")})`,
      [accountId, ...payload.customerIds]
    );
    if (customerRows.length !== payload.customerIds.length)
      return res.status(400).json({ message: "Danh sách khách hàng không hợp lệ." });

    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(`
        UPDATE campaigns SET name=?, content=?, status=?, scheduled_at=DATE_ADD(NOW(), INTERVAL ? MINUTE),
          delay_minutes=?, interval_seconds=? WHERE id=? AND zalo_account_id=?
      `, [payload.name, payload.content, payload.delayMinutes > 0 ? "SCHEDULED" : "DRAFT",
        payload.delayMinutes, payload.delayMinutes, payload.intervalSeconds, id, accountId]);
      await connection.execute("DELETE FROM campaign_customers WHERE campaign_id = ?", [id]);
      await connection.query(
        "INSERT INTO campaign_customers (campaign_id, customer_id) VALUES ?",
        [payload.customerIds.map(customerId => [id, customerId])]
      );
      await connection.commit();
      res.json({ success: true, message: "Đã cập nhật chiến dịch." });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("[CAMPAIGNS] update:", error);
    res.status(400).json({ message: error.message || "Không thể cập nhật chiến dịch." });
  }
}

export async function deleteCampaign(req, res) {
  try {
    const [result] = await db.execute(
      `DELETE FROM campaigns
       WHERE id = ? AND zalo_account_id = ? AND status IN ('DRAFT','SCHEDULED')`,
      [Number(req.params.id), req.session.accountId]
    );
    if (!result.affectedRows)
      return res.status(409).json({ message: "Không tìm thấy chiến dịch hoặc chiến dịch đã bắt đầu nên không thể xóa." });
    res.json({ success: true, message: "Đã xóa chiến dịch." });
  } catch (error) {
    console.error("[CAMPAIGNS] delete:", error);
    res.status(500).json({ message: "Không thể xóa chiến dịch." });
  }
}
