import express from "express";
import {
  listCampaigns,
  listCampaignCustomers,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign
} from "../controllers/campaign.controller.js";

import campaignSender from "../services/campaign-sender.service.js";

const router = express.Router();

router.get("/", listCampaigns);
router.get("/customers", listCampaignCustomers);
router.get("/:id", getCampaign);
router.post("/", createCampaign);
router.put("/:id", updateCampaign);
router.delete("/:id", deleteCampaign);

// Gửi chiến dịch đến các khách hàng đã chọn
router.post("/:id/send", async (req, res) => {
  try {
    const accountId = req.session?.accountId;
    const campaignId = Number(req.params.id);

    if (!accountId) {
      return res.status(401).json({
        message: "Phiên đăng nhập đã hết hạn."
      });
    }

    if (!Number.isSafeInteger(campaignId) || campaignId <= 0) {
      return res.status(400).json({
        message: "ID chiến dịch không hợp lệ."
      });
    }

    const result = await campaignSender.sendCampaign(
      campaignId,
      accountId
    );

    return res.json({
      message: "Đã xử lý xong chiến dịch.",
      data: result
    });
  } catch (error) {
    console.error("[CAMPAIGN SEND]", error);

    return res.status(400).json({
      message: error.message || "Không thể gửi chiến dịch."
    });
  }
});

export default router;
