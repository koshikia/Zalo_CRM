import express from "express";
import {
  getStatus,
  startQrLogin,
  getQrStatus,
  getQrImage,
  claimSession,
  logout
} from "../controllers/zalo.controller.js";

const router = express.Router();

router.get("/status", getStatus);
router.post("/login/qr", startQrLogin);
router.get("/login/qr/status", getQrStatus);
router.get("/login/qr/image", getQrImage);
router.post("/session/claim", claimSession);
router.post("/logout", logout);

export default router;
