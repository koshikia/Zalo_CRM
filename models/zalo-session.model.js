import { Zalo, ThreadType } from "zca-js";
import db from "../config/database.js";
import { decryptCredentials, encryptCredentials } from "../config/credential.js";
import {
  findRestorableAccounts,
  createOrUpdateConnected,
  markStatus,
  markConnected
} from "./zalo-account.model.js";
import { findOrCreateByZalo } from "./user.model.js";
import { upsertCustomer, normalizeUserInfo } from "./customer.model.js";

class ZaloSessionModel {
  constructor() {
    this.sessions = new Map();
    this.pending = null;
    this.lastQrResult = null;
  }

  get(accountId) {
    return this.sessions.get(String(accountId));
  }

  has(accountId) {
    return this.sessions.has(String(accountId));
  }

  async restoreAll() {
    // Chỉ khôi phục đúng 1 tài khoản CONNECTED gần nhất.
    // Tài khoản đã logout sẽ có status=DISCONNECTED nên không được restore.
    const rows = await findRestorableAccounts();
    const row = rows[0];

    if (!row) {
      console.log("[ZALO] Không có tài khoản CONNECTED để restore session.");
      return;
    }

    try {
      const credentials = decryptCredentials(row.credential_ciphertext);
      await this.loginWithCredentials(
        row.id,
        row.user_id,
        credentials,
        false
      );
      console.log(`[ZALO] Đã khôi phục tài khoản Zalo ${row.id}`);
    } catch (error) {
      console.error(
        `[ZALO] Khôi phục thất bại cho tài khoản Zalo ${row.id}:`,
        error.message
      );
      await markStatus(row.id, "EXPIRED", error.message);
    }
  }

  async logout(accountId) {
    const key = String(accountId);
    const session = this.sessions.get(key);

    // Xóa session trong RAM trước để API không thể dùng lại session cũ.
    this.sessions.delete(key);

    // Dừng listener WebSocket nếu session đang chạy.
    try {
      if (session?.api?.listener) {
        session.api.listener.stop();
      }
    } catch (error) {
      console.warn(
        `[ZALO] stop listener for account ${accountId} failed:`,
        error.message
      );
    }

    // Quan trọng: giữ credential nhưng đánh dấu DISCONNECTED.
    // restoreAll() chỉ restore status=CONNECTED nên account này sẽ không
    // được tự động đăng nhập lại sau khi server restart.
    await markStatus(accountId, "DISCONNECTED", null);
  }

  async startQrLogin() {
    if (this.pending) {
      throw new Error("A QR login is already in progress");
    }

    this.pending = {
      status: "GENERATING",
      qrPath: null,
      message: "Đang tạo mã QR...",
      error: null
    };

    const zalo = new Zalo({
      logging: false,
      selfListen: false
    });

    const qrPath = "./storage/qr/login.png";
    this.pending.qrPath = qrPath;

    const loginPromise = zalo.loginQR(
      {
        userAgent: process.env.ZALO_USER_AGENT,
        language: "vi",
        qrPath
      },
      async (event) => {
        await this.handleQrEvent(event);
      }
    );

    try {
      const api = await loginPromise;
      const credentials = this.pending?.credentials;

      if (!credentials) {
        throw new Error("Zalo login succeeded but credentials were not returned");
      }

      const accountInfo = await this.getOwnAccountInfo(api);
      const zaloUserId = String(
        accountInfo.zaloUserId ||
          credentials.userId ||
          credentials.user_id ||
          ""
      );
      const zaloName =
        accountInfo.displayName ||
        credentials.displayName ||
        credentials.display_name ||
        null;

      if (!zaloUserId) {
        throw new Error("Cannot determine the Zalo account ID after QR login");
      }

      const userId = await findOrCreateByZalo(zaloUserId, zaloName);
      const accountId = await createOrUpdateConnected({
        userId,
        zaloUserId,
        zaloName,
        credentialCiphertext: encryptCredentials(credentials)
      });

      await this.registerListener(accountId, api);
      this.sessions.set(String(accountId), {
        api,
        userId,
        zaloUserId,
        zaloName
      });

      this.pending.status = "CONNECTED";
      this.pending.message = "Đăng nhập thành công";
      this.pending.accountId = accountId;
      this.pending.credentials = null;

      this.lastQrResult = {
        status: "CONNECTED",
        message: "Đăng nhập thành công",
        accountId
      };

      return this.pending;
    } catch (error) {
      if (this.pending) {
        this.pending.status = "ERROR";
        this.pending.error = error.message;
      }
      this.pending = null;
      throw error;
    }
  }

  async handleQrEvent(event) {
    if (!this.pending) return;

    const type = event?.type;
    const data = event?.data ?? {};
    const enumObject = (await import("zca-js")).LoginQRCallbackEventType;
    const names = Object.entries(enumObject || {});
    const eventName = names.find(([, value]) => value === type)?.[0];

    if (eventName === "QRCodeGenerated") {
      this.pending.status = "QR_READY";
      this.pending.message = "Mở Zalo trên điện thoại và quét mã QR.";

      try {
        if (event.actions?.saveToFile) {
          await event.actions.saveToFile("./storage/qr/login.png");
        }
      } catch (error) {
        this.pending.message =
          "QR đã tạo nhưng không lưu được ảnh: " + error.message;
      }
    } else if (eventName === "QRCodeScanned") {
      this.pending.status = "SCANNED";
      this.pending.message = `Đã quét QR${
        data.display_name ? ` bởi ${data.display_name}` : ""
      }. Xác nhận trên điện thoại.`;
    } else if (eventName === "QRCodeExpired") {
      this.pending.status = "EXPIRED";
      this.pending.message =
        "Mã QR đã hết hạn. Bấm đăng nhập lại để tạo mã mới.";
    } else if (eventName === "QRCodeDeclined") {
      this.pending.status = "DECLINED";
      this.pending.message = "Bạn đã từ chối đăng nhập trên điện thoại.";
    } else if (eventName === "GotLoginInfo") {
      this.pending.credentials = data;
      this.pending.status = "AUTHENTICATED";
      this.pending.message = "Đang khởi tạo phiên Zalo...";
    }
  }

  async loginWithCredentials(accountId, userId, credentials, throwOnFailure = true) {
    try {
      const zalo = new Zalo({
        logging: false,
        selfListen: false
      });

      const api = await zalo.login(credentials);
      const accountInfo = await this.getOwnAccountInfo(api);
      const zaloUserId = String(
        accountInfo.zaloUserId ||
          credentials.userId ||
          credentials.user_id ||
          ""
      );
      const zaloName =
        accountInfo.displayName ||
        credentials.displayName ||
        credentials.display_name ||
        null;

      await this.registerListener(accountId, api);
      this.sessions.set(String(accountId), {
        api,
        userId,
        zaloUserId,
        zaloName
      });

      await markConnected(accountId, zaloUserId, zaloName);
      return api;
    } catch (error) {
      if (throwOnFailure) throw error;
      throw error;
    }
  }

  async getOwnAccountInfo(api) {
    try {
      if (typeof api.getOwnId === "function") {
        const idResult = await api.getOwnId();
        const zaloUserId = idResult?.userId ?? idResult?.id ?? idResult;

        if (zaloUserId) {
          try {
            const profile = await api.getUserInfo(String(zaloUserId));
            const normalized = normalizeUserInfo(profile);
            return {
              zaloUserId: String(zaloUserId),
              displayName: normalized.displayName
            };
          } catch {}

          return { zaloUserId: String(zaloUserId) };
        }
      }
    } catch {}

    try {
      if (typeof api.fetchAccountInfo === "function") {
        const result = await api.fetchAccountInfo();
        const normalized = normalizeUserInfo(result);
        if (normalized.zaloUserId) return normalized;
      }
    } catch {}

    return {};
  }

  async registerListener(accountId, api) {
    if (this.has(accountId)) return;

    api.listener.on("message", async (message) => {
      try {
        if (message?.isSelf) return;

        const ThreadType = (await import("zca-js")).ThreadType;
        if (message?.type !== ThreadType.User) return;

        const zaloUserId = String(message.threadId);
        let info = {};

        try {
          const rawInfo = await api.getUserInfo(zaloUserId);
          console.log(
            "[ZALO] getUserInfo RAW:",
            JSON.stringify(rawInfo, null, 2)
          );
          info = normalizeUserInfo(rawInfo);
        } catch (error) {
          console.warn(
            `[ZALO] getUserInfo(${zaloUserId}) failed:`,
            error.message
          );
        }

        await upsertCustomer({
          zaloAccountId: accountId,
          zaloUserId,
          displayName: info.displayName,
          phone: info.phone
        });
        await markLatestCampaignReplied(accountId, zaloUserId);

        console.log(
          `[ZALO] Customer captured: ${zaloUserId} - ${
            info.displayName || "Unknown"
          }`
        );
      } catch (error) {
        console.error("[ZALO] message handler error:", error);
      }
    });
    //Zalo phát sự kiện khi xem
    api.listener.on("seen_messages", async (messages = []) => {
      try {
        const { ThreadType } = await import("zca-js");
        for (const seen of messages) {
          if (seen?.type !== ThreadType.User || !seen.threadId) {
            continue;
          }
          const zaloUserId = String (seen.threadId);

          const [result] = await db.execute (
              `UPDATE campaign_customers AS cc
              INNER JOIN customers AS c
                ON c.id = cc.customer_id
              SET cc.view_status = 'VIEWED',
                  cc.viewed_at = COALESCE(cc.viewed_at, NOW()),
                  cc.reply_status = CASE
                    WHEN cc.reply_status IS NULL
                      OR cc.reply_status = 'UNKNOWN'
                      OR cc.reply_status = 'PENDING'
                    THEN 'NOT_REPLIED'
                    ELSE cc.reply_status
                  END
                WHERE c.zalo_account_id = ?
                  AND c.zalo_user_id = ?
                  AND cc.send_status = 'SENT'
                  AND (
                    cc.view_status IS NULL
                    OR cc.view_status <> 'VIEWED'
                    OR cc.reply_status IS NULL
                    OR cc.reply_status IN ('UNKNOWN', 'PENDING')
                  )`,
                [accountId, zaloUserId]
              );
        }
      } catch (error) {
        console.error(
          `[ZALO] seen_messages handler error for account ${accountId}:`,
          error
    );
  }
});
    api.listener.on("disconnected", async (reason) => {
      console.warn(`[ZALO] account ${accountId} disconnected`, reason);
      await markStatus(
        accountId,
        "DISCONNECTED",
        String(reason ?? "disconnected")
      );
    });

    api.listener.on("closed", async (reason) => {
      console.warn(`[ZALO] account ${accountId} listener closed`, reason);
      await markStatus(
        accountId,
        "DISCONNECTED",
        String(reason ?? "closed")
      );
    });

    api.listener.start();
  }

  getPendingQrStatus() {
    if (this.pending) {
      return {
        status: this.pending.status,
        message: this.pending.message,
        error: this.pending.error,
        accountId: this.pending.accountId
      };
    }

    if (this.lastQrResult) return this.lastQrResult;

    return {
      status: "IDLE",
      message: "Chưa có phiên QR."
    };
  }
}

async function markLatestCampaignViewed(accountId, zaloUserId) {
  const [rows] = await db.execute(
    `SELECT cc.id
     FROM campaign_customers cc
     INNER JOIN campaigns c ON c.id = cc.campaign_id
     INNER JOIN customers cu ON cu.id = cc.customer_id
     WHERE c.zalo_account_id = ?
       AND cu.zalo_account_id = ?
       AND cu.zalo_user_id = ?
       AND cc.send_status = 'SENT'
       AND cc.view_status <> 'VIEWED'
     ORDER BY cc.sent_at DESC, cc.id DESC
     LIMIT 1`,
    [accountId, accountId, String(zaloUserId)]
  );

  if (!rows.length) return;

  await db.execute(
    `UPDATE campaign_customers
     SET view_status = 'VIEWED',
         viewed_at = COALESCE(viewed_at, NOW())
     WHERE id = ?`,
    [rows[0].id]
  );
}
async function markLatestCampaignReplied(accountId, zaloUserId) {
  const [rows] = await db.execute(
    `SELECT cc.id
     FROM campaign_customers cc
     INNER JOIN campaigns c ON c.id = cc.campaign_id
     INNER JOIN customers cu ON cu.id = cc.customer_id
     WHERE c.zalo_account_id = ?
       AND cu.zalo_account_id = ?
       AND cu.zalo_user_id = ?
       AND cc.send_status = 'SENT'
       AND cc.sent_at IS NOT NULL
       AND cc.reply_status <> 'REPLIED'
     ORDER BY cc.sent_at DESC, cc.id DESC
     LIMIT 1`,
    [accountId, accountId, String(zaloUserId)]
  );

  if (!rows.length) return;

  await db.execute(
    `UPDATE campaign_customers
     SET reply_status = 'REPLIED',
         replied_at = COALESCE(replied_at, NOW()),
         view_status = 'VIEWED',
         viewed_at = COALESCE(viewed_at, NOW())
     WHERE id = ?`,
    [rows[0].id]
  );
}
export default new ZaloSessionModel();
