import db from "../config/database.js";
import campaignSender from "./campaign-sender.service.js";

const CHECK_INTERVAL_MS = 10_000;
const BATCH_SIZE = 20;

class CampaignSchedulerService {
  timer = null;
  isChecking = false;

  /**
   * Khởi động bộ lập lịch.
   * Gọi một lần khi server khởi động.
   */
  start() {
    if (this.timer) {
      console.log("[CAMPAIGN SCHEDULER] Đã khởi động.");
      return;
    }

    console.log(
      "[CAMPAIGN SCHEDULER] Bắt đầu kiểm tra chiến dịch mỗi 10 giây."
    );

    // Kiểm tra ngay khi khởi động.
    void this.checkDueCampaigns();

    // Sau đó kiểm tra định kỳ.
    this.timer = setInterval(() => {
      void this.checkDueCampaigns();
    }, CHECK_INTERVAL_MS);

    // Không giữ tiến trình Node.js chỉ vì timer này.
    this.timer.unref?.();
  }

  /**
   * Dừng bộ lập lịch khi cần.
   */
  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    console.log("[CAMPAIGN SCHEDULER] Đã dừng.");
  }

  /**
   * Tìm và xử lý các chiến dịch đã đến hạn.
   */
  async checkDueCampaigns() {
    // Ngăn các lần kiểm tra chồng lấn trong cùng tiến trình.
    if (this.isChecking) return;

    this.isChecking = true;

    try {
      const [campaigns] = await db.execute(
        `SELECT
            id,
            zalo_account_id,
            name,
            scheduled_at
         FROM campaigns
         WHERE status = 'SCHEDULED'
           AND scheduled_at IS NOT NULL
           AND scheduled_at <= NOW()
         ORDER BY scheduled_at ASC, id ASC
         LIMIT ${BATCH_SIZE}`
      );

      if (campaigns.length > 0) {
        console.log(
          `[CAMPAIGN SCHEDULER] Tìm thấy ${campaigns.length} chiến dịch đến hạn.`
        );
      }

      for (const campaign of campaigns) {
        try {
          console.log(
            `[CAMPAIGN SCHEDULER] Bắt đầu chiến dịch #${campaign.id}: ${campaign.name}`
          );

          const result = await campaignSender.sendCampaign(
            campaign.id,
            campaign.zalo_account_id
          );

          console.log(
            `[CAMPAIGN SCHEDULER] Chiến dịch #${campaign.id} đã xử lý.`,
            {
              total: result.total,
              sent: result.sent,
              failed: result.failed
            }
          );
        } catch (error) {
          console.error(
            `[CAMPAIGN SCHEDULER] Không thể gửi chiến dịch #${campaign.id}:`,
            error.message
          );

          // Không tự chuyển sang FAILED ở đây.
          // Nếu tài khoản chưa kết nối hoặc chưa có phiên Zalo,
          // chiến dịch sẽ được kiểm tra lại ở lần tiếp theo.
        }
      }
    } catch (error) {
      console.error(
        "[CAMPAIGN SCHEDULER] Lỗi kiểm tra chiến dịch:",
        error
      );
    } finally {
      this.isChecking = false;
    }
  }
}

export default new CampaignSchedulerService();