
import db from "../config/database.js";
import zaloSession from "./zalo-session.service.js";
import { ThreadType } from "zca-js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CampaignSenderService {
  // Chặn chạy đồng thời cùng một chiến dịch trong tiến trình hiện tại.
  runningCampaigns = new Set();

  async sendCampaign(campaignId, accountId) {
    const campaignKey = String(campaignId);

    if (this.runningCampaigns.has(campaignKey)) {
      throw new Error("Chiến dịch này đang được gửi.");
    }

    const session = zaloSession.get(accountId);

    if (!session?.api) {
      throw new Error("Tài khoản Zalo chưa kết nối.");
    }

    this.runningCampaigns.add(campaignKey);

    try {
      const [campaignRows] = await db.execute(
        `SELECT id, name, content, status, interval_seconds
         FROM campaigns
         WHERE id = ? AND zalo_account_id = ?
         LIMIT 1`,
        [campaignId, accountId]
      );

      const campaign = campaignRows[0];

      if (!campaign) {
        throw new Error("Không tìm thấy chiến dịch.");
      }

      if (!campaign.content?.trim()) {
        throw new Error("Nội dung chiến dịch đang trống.");
      }

      if (["RUNNING", "COMPLETED", "CANCELLED"].includes(campaign.status)) {
        throw new Error(
          `Không thể gửi chiến dịch có trạng thái ${campaign.status}.`
        );
      }

      const [targets] = await db.execute(
        `SELECT
            cc.id AS target_id,
            c.id AS customer_id,
            c.zalo_user_id
         FROM campaign_customers cc
         INNER JOIN customers c ON c.id = cc.customer_id
         WHERE cc.campaign_id = ?
           AND c.zalo_account_id = ?
           AND cc.send_status = 'PENDING'
         ORDER BY cc.id ASC`,
        [campaignId, accountId]
      );

      if (targets.length === 0) {
        throw new Error(
          "Không có khách hàng nào đang ở trạng thái PENDING."
        );
      }

      // Khoảng nghỉ tối thiểu 5 giây giữa các tin nhắn.
      const intervalSeconds = Math.max(
        5,
        Number(campaign.interval_seconds) || 10
      );

      await db.execute(
        `UPDATE campaigns
         SET status = 'RUNNING', started_at = COALESCE(started_at, NOW())
         WHERE id = ? AND zalo_account_id = ?`,
        [campaignId, accountId]
      );

      let sent = 0;
      let failed = 0;

      for (let i = 0; i < targets.length; i++) {
        const target = targets[i];

        if (!target.zalo_user_id) {
          await markFailed(target.target_id, "Khách hàng thiếu Zalo user ID.");
          failed++;
          continue;
        }

        // Đánh dấu trước khi gọi API để hạn chế xử lý trùng.
        await db.execute(
          `UPDATE campaign_customers
           SET send_status = 'SENDING'
           WHERE id = ? AND send_status = 'PENDING'`,
          [target.target_id]
        );

        try {
          // API gửi tin nhắn của zca-js.
          await session.api.sendMessage(
            { msg: campaign.content },
            String(target.zalo_user_id),
            ThreadType.User
          );

          await db.execute(
            `UPDATE campaign_customers
             SET send_status = 'SENT',
                 sent_at = NOW(),
                 error_message = NULL
             WHERE id = ?`,
            [target.target_id]
          );

          sent++;
        } catch (error) {
          await markFailed(target.target_id, error.message);
          failed++;
        }

        // Không gửi dồn dập; nghỉ giữa các khách hàng.
        if (i < targets.length - 1) {
          await sleep(intervalSeconds * 1000);
        }
      }

      // Chỉ đánh dấu hoàn tất khi vòng gửi đã xử lý xong.
      // Ghi nhận trạng thái chưa có tín hiệu xem tại thời điểm
      // kết thúc chiến dịch. Listener vẫn có thể cập nhật VIEWED
      // nếu sự kiện xem đến sau đó.
      await db.execute(
        `UPDATE campaign_customers
        SET view_status = 'NOT_VIEWED'
        WHERE campaign_id = ?
        AND send_status = 'SENT'
        AND view_status = 'UNKNOWN'`,
        [campaignId]
      );

      await db.execute(
        `UPDATE campaigns
        SET status = 'COMPLETED',
        completed_at = NOW()
        WHERE id = ? AND zalo_account_id = ?`,
        [campaignId, accountId]
      );

      return {
        campaignId,
        total: targets.length,
        sent,
        failed
      };
    } finally {
      this.runningCampaigns.delete(campaignKey);
    }
  }
}

async function markFailed(targetId, errorMessage) {
  await db.execute(
    `UPDATE campaign_customers
     SET send_status = 'FAILED', error_message = ?
     WHERE id = ?`,
    [String(errorMessage || "Gửi tin nhắn thất bại").slice(0, 1000), targetId]
  );
}

export default new CampaignSenderService();
