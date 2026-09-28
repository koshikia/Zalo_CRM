import express from "express";
import db from "../config/database.js";
import zaloSession from "../services/zalo-session.service.js";
import path from "path";
const router = express.Router();

router.get("/status", async (req, res) => {
  try {
    let accountId = req.session.accountId;

    // ==========================================
    // 1. Trình duyệt đã có session
    // ==========================================
    if (accountId) {
      const [rows] = await db.execute(
        `SELECT id, user_id, zalo_user_id, zalo_name, status, last_connected_at
         FROM zalo_accounts
         WHERE id=?`,
        [accountId]
      );

      if (
        rows.length &&
        rows[0].status === "CONNECTED" &&
        zaloSession.has(accountId)
      ) {
        return res.json({
          authenticated: true,
          restored: false,
          account: rows[0]
        });
      }

      // Session cũ không còn hợp lệ
      req.session = null;
    }

    // ==========================================
    // 2. Không có session trình duyệt
    // → tìm Zalo session đã được restore
    // ==========================================
    const [rows] = await db.execute(`
      SELECT id, user_id, zalo_user_id, zalo_name, status, last_connected_at
      FROM zalo_accounts
      WHERE status='CONNECTED'
      ORDER BY last_connected_at DESC
      LIMIT 1
    `);

    if (
      rows.length &&
      zaloSession.has(rows[0].id)
    ) {
      // Tạo lại session cho trình duyệt
      req.session.accountId = rows[0].id;
      req.session.userId = rows[0].user_id;

      return res.json({
        authenticated: true,
        restored: true,
        account: rows[0]
      });
    }

    // ==========================================
    // 3. Không có session nào
    // ==========================================
    return res.json({
      authenticated: false,
      status: "NOT_LOGGED_IN"
    });

  } catch (error) {
    console.error("[STATUS ERROR]", error);

    return res.status(500).json({
      authenticated: false,
      status: "ERROR",
      message: error.message
    });
  }
});

router.post("/login/qr", async (req, res) => {
  try {
    if (zaloSession.pending) {
      return res.status(409).json({
        success: false,
        message: "Đang có một phiên QR đăng nhập."
      });
    }

    // Start asynchronously so the HTTP request returns immediately.
    zaloSession.startQrLogin().then(async (result) => {
      if (result?.accountId) {
        // The browser that started the QR must fetch status through a separate
        // endpoint; accountId is deliberately not put into the cookie here.
      }
    }).catch((error) => {
      console.error("[QR] login failed:", error);
    });

    res.json({
      success: true,
      message: "Đã bắt đầu tạo QR."
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get("/login/qr/status", (req, res) => {
  res.json(zaloSession.getPendingQrStatus());
});

router.get("/login/qr/image", (req, res) => {
  const qrPath= path.join(process.cwd(),"storage","qr","login.png");

  res.sendFile(qrPath,(err)=> {
    if(err) {
      console.error("Không thể gửi QR:", err);

      if(!res.headersSent) {
        res.status(404).json({
          message:"Không tìm thấy file QR"
        });
      }
    }
  });
});

router.post("/session/claim", async (req, res) => {
  try {
    // Nếu vừa đăng nhập QR thì ưu tiên accountId từ phiên QR
    let accountId = zaloSession.pending?.accountId;

    // Nếu không có thì lấy account CONNECTED gần nhất
    if (!accountId) {
      const [rows] = await db.query(`
        SELECT id, user_id, zalo_user_id, zalo_name, status
        FROM zalo_accounts
        WHERE status='CONNECTED'
        ORDER BY last_connected_at DESC
        LIMIT 1
      `);

      if (!rows.length) {
        return res.status(404).json({
          success: false,
          message: "Chưa có tài khoản Zalo đã kết nối."
        });
      }

      accountId = rows[0].id;
    }

    if (!zaloSession.has(accountId)) {
      return res.status(404).json({
        success: false,
        message: "Phiên Zalo chưa được khôi phục."
      });
    }

    const [rows] = await db.execute(
      `SELECT id, user_id, zalo_user_id, zalo_name, status
       FROM zalo_accounts
       WHERE id=?`,
      [accountId]
    );

    if (!rows.length) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy tài khoản Zalo."
      });
    }

    req.session.accountId = rows[0].id;
    req.session.userId = rows[0].user_id;

    // QR login đã hoàn thành
    zaloSession.pending = null;
    zaloSession.lastQrResult = null;

    return res.json({
      success: true,
      account: rows[0]
    });

  } catch (error) {
    console.error("[SESSION CLAIM ERROR]", error);

    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

router.post("/logout", async (req, res) => {
  const accountId = req.session.accountId;
  req.session = null;

  if (accountId) {
    await db.execute(
      `UPDATE zalo_accounts SET status='DISCONNECTED' WHERE id=?`,
      [accountId]
    );
  }

  res.json({ success: true });
});

export default router;
