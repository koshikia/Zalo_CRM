import { Zalo } from "zca-js";
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
    const rows = await findRestorableAccounts();

    for (const row of rows) {
      try {
        const credentials = decryptCredentials(row.credential_ciphertext);
        await this.loginWithCredentials(
          row.id,
          row.user_id,
          credentials,
          false
        );
        console.log(`[ZALO] restored account ${row.id}`);
      } catch (error) {
        console.error(
          `[ZALO] restore failed for account ${row.id}:`,
          error.message
        );
        await markStatus(row.id, "EXPIRED", error.message);
      }
    }
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

        console.log(
          `[ZALO] Customer captured: ${zaloUserId} - ${
            info.displayName || "Unknown"
          }`
        );
      } catch (error) {
        console.error("[ZALO] message handler error:", error);
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

export default new ZaloSessionModel();
