import path from "node:path";
import { findById, findLatestConnected, markStatus } from "../models/zalo-account.model.js";
import zaloSession from "../models/zalo-session.model.js";

export async function getStatus(req, res) {
  try {
    let accountId = req.session.accountId;

    if (accountId) {
      const account = await findById(accountId);

      if (account?.status === "CONNECTED" && zaloSession.has(accountId)) {
        return res.json({
          authenticated: true,
          restored: false,
          account
        });
      }

      req.session = null;
    }

    const account = await findLatestConnected();

    if (account && zaloSession.has(account.id)) {
      req.session.accountId = account.id;
      req.session.userId = account.user_id;

      return res.json({
        authenticated: true,
        restored: true,
        account
      });
    }

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
}

export async function startQrLogin(req, res) {
  try {
    if (zaloSession.pending) {
      return res.status(409).json({
        success: false,
        message: "Đang có một phiên QR đăng nhập."
      });
    }

    zaloSession
      .startQrLogin()
      .catch((error) => console.error("[QR] login failed:", error));

    return res.json({
      success: true,
      message: "Đã bắt đầu tạo QR."
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

export function getQrStatus(req, res) {
  return res.json(zaloSession.getPendingQrStatus());
}

export function getQrImage(req, res) {
  const qrPath = path.join(process.cwd(), "storage", "qr", "login.png");

  return res.sendFile(qrPath, (error) => {
    if (!error) return;

    console.error("Không thể gửi QR:", error);
    if (!res.headersSent) {
      res.status(404).json({ message: "Không tìm thấy file QR" });
    }
  });
}

export async function claimSession(req, res) {
  try {
    let accountId = zaloSession.pending?.accountId;

    if (!accountId) {
      const account = await findLatestConnected();
      if (!account) {
        return res.status(404).json({
          success: false,
          message: "Chưa có tài khoản Zalo đã kết nối."
        });
      }
      accountId = account.id;
    }

    if (!zaloSession.has(accountId)) {
      return res.status(404).json({
        success: false,
        message: "Phiên Zalo chưa được khôi phục."
      });
    }

    const account = await findById(accountId);
    if (!account) {
      return res.status(404).json({
        success: false,
        message: "Không tìm thấy tài khoản Zalo."
      });
    }

    req.session.accountId = account.id;
    req.session.userId = account.user_id;

    zaloSession.pending = null;
    zaloSession.lastQrResult = null;

    return res.json({ success: true, account });
  } catch (error) {
    console.error("[SESSION CLAIM ERROR]", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

export async function logout(req, res) {
  try {
    const accountId = req.session.accountId;
    req.session = null;

    if (accountId) {
      await markStatus(accountId, "DISCONNECTED", null);
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("[LOGOUT ERROR]", error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
}

export { zaloSession };
