import express from "express";
import {
  getStats,
  getCustomers
} from "../controllers/dashboard.controller.js";

const router = express.Router();

router.get("/stats", getStats);
router.get("/customers", getCustomers);

export default router;
