import express from "express";
import {
  listCampaigns,
  listCampaignCustomers,
  getCampaign,
  createCampaign,
  updateCampaign,
  deleteCampaign
} from "../controllers/campaign.controller.js";

const router = express.Router();
router.get("/", listCampaigns);
router.get("/customers", listCampaignCustomers);
router.get("/:id", getCampaign);
router.post("/", createCampaign);
router.put("/:id", updateCampaign);
router.delete("/:id", deleteCampaign);
export default router;
