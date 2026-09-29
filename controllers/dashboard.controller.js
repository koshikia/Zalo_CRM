import { findById } from "../models/zalo-account.model.js";
import {
  countByAccount,
  countTodayByAccount,
  findRecentByAccount
} from "../models/customer.model.js";

export async function getStats(req, res) {
  try {
    const accountId = req.session.accountId;
    const [totalCustomers, customersToday, account] = await Promise.all([
      countByAccount(accountId),
      countTodayByAccount(accountId),
      findById(accountId)
    ]);

    return res.json({
      totalCustomers,
      customersToday,
      account
    });
  } catch (error) {
    console.error("[DASHBOARD STATS ERROR]", error);
    return res.status(500).json({
      message: "Không thể tải thống kê.",
      error: error.message
    });
  }
}

export async function getCustomers(req, res) {
  try {
    const customers = await findRecentByAccount(req.session.accountId, 100);
    return res.json(customers);
  } catch (error) {
    console.error("[DASHBOARD CUSTOMERS ERROR]", error);
    return res.status(500).json({
      message: "Không thể tải danh sách khách hàng.",
      error: error.message
    });
  }
}
