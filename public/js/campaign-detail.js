const $ = (id) => document.getElementById(id);

let campaign = null;
let recipients = [];
let activeFilter = "ALL";

// Lưu ID khách hàng đã chọn.
const selectedCustomerIds = new Set();

const sendLabels = {
  PENDING: "Chờ gửi",
  SENDING: "Đang gửi",
  SENT: "Đã gửi",
  FAILED: "Gửi thất bại",
  SKIPPED: "Đã bỏ qua"
};

const viewLabels = {
  UNKNOWN: "Chưa xác định",
  VIEWED: "Đã xem",
  NOT_VIEWED: "Chưa xem",
  BLOCKED: "Bị chặn"
};

const replyLabels = {
  UNKNOWN: "Chưa xác định",
  REPLIED: "Đã phản hồi",
  NOT_REPLIED: "Chưa phản hồi"
};

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401) {
    window.location.href = "/";
    throw new Error("Phiên đăng nhập đã hết hạn.");
  }

  if (!response.ok) {
    throw new Error(data.message || "Không thể tải dữ liệu.");
  }

  return data;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "—";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("vi-VN");
}

function label(map, value) {
  return map[value] || value || "Chưa xác định";
}

function badgeClass(value) {
  if (["SENT", "VIEWED", "REPLIED"].includes(value)) {
    return "state-success";
  }

  if (["FAILED", "BLOCKED"].includes(value)) {
    return "state-danger";
  }

  if (["PENDING", "SENDING", "NOT_VIEWED"].includes(value)) {
    return "state-warning";
  }

  return "";
}

function badge(map, value) {
  return `
    <span class="state-badge ${badgeClass(value)}">
      ${escapeHtml(label(map, value))}
    </span>
  `;
}

// Tải chiến dịch và danh sách khách hàng.
async function loadCampaignDetail() {
  try {
    const id = Number(
      window.location.pathname.split("/").filter(Boolean).pop()
    );

    if (!Number.isSafeInteger(id) || id <= 0) {
      throw new Error("ID chiến dịch không hợp lệ.");
    }

    campaign = await api(`/api/campaigns/${id}`);
    recipients = campaign.recipients || [];

    renderCampaignSummary();
    renderRecipients();
  } catch (error) {
    $("campaign-name").textContent = "Không thể tải chiến dịch";
    $("page-message").textContent = error.message;
    $("recipient-list").innerHTML = `
      <tr>
        <td colspan="11">${escapeHtml(error.message)}</td>
      </tr>
    `;
  }
}

// Hiển thị thông tin tổng quan.
function renderCampaignSummary() {
  $("campaign-name").textContent = campaign.name || "Chiến dịch";

  $("campaign-description").textContent =
    `Trạng thái: ${campaign.status} · ` +
    `Tạo lúc: ${formatDate(campaign.created_at)} · ` +
    `Lịch gửi: ${formatDate(campaign.scheduled_at)}`;

  const count = (predicate) =>
    recipients.filter(predicate).length;

  $("total-count").textContent = recipients.length;

  $("sent-count").textContent = count(
    item => item.send_status === "SENT"
  );

  $("viewed-count").textContent = count(
    item => item.view_status === "VIEWED"
  );

  $("replied-count").textContent = count(
    item => item.reply_status === "REPLIED"
  );

  $("not-viewed-count").textContent = count(
    item => item.view_status === "NOT_VIEWED"
  );

  $("failed-count").textContent = count(
    item => item.send_status === "FAILED"
  );

  $("create-followup").disabled = recipients.length === 0;
}

// Áp dụng bộ lọc trạng thái và từ khóa.
function getFilteredRecipients() {
  const query = $("search-customer").value
    .trim()
    .toLowerCase();

  return recipients.filter(item => {
    const text = [
      item.display_name,
      item.phone,
      item.zalo_user_id
    ].join(" ").toLowerCase();

    if (query && !text.includes(query)) {
      return false;
    }

    switch (activeFilter) {
      case "REPLIED":
        return item.reply_status === "REPLIED";

      case "VIEWED":
        return item.view_status === "VIEWED";

      case "NOT_VIEWED":
        return item.view_status === "NOT_VIEWED";

      case "FAILED":
        return item.send_status === "FAILED";

      case "PENDING":
        return ["PENDING", "SENDING"].includes(item.send_status);

      default:
        return true;
    }
  });
}

// Hiển thị bảng chi tiết.
function renderRecipients() {
  const filtered = getFilteredRecipients();
  const tbody = $("recipient-list");

  if (!filtered.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11">
          Không có khách hàng phù hợp với bộ lọc.
        </td>
      </tr>
    `;

    $("select-visible").checked = false;
    updateSelectionCount();
    return;
  }

  tbody.innerHTML = filtered.map(item => {
    const id = Number(item.customer_id);

    return `
      <tr>
        <td>
          <input
            type="checkbox"
            data-customer-id="${id}"
            ${selectedCustomerIds.has(id) ? "checked" : ""}
            aria-label="Chọn khách hàng"
          >
        </td>

        <td>
          <div class="recipient-name">
            ${escapeHtml(item.display_name || "Chưa xác định tên")}
          </div>

          <div class="recipient-sub">
            Trạng thái tài khoản: ${escapeHtml(item.customer_status || "—")}
          </div>
        </td>

        <td>${escapeHtml(item.phone || "Chưa có")}</td>

        <td>${escapeHtml(item.zalo_user_id || "—")}</td>

        <td>${badge(sendLabels, item.send_status)}</td>

        <td>${badge(viewLabels, item.view_status)}</td>

        <td>${badge(replyLabels, item.reply_status)}</td>

        <td>${escapeHtml(formatDate(item.sent_at))}</td>

        <td>${escapeHtml(formatDate(item.viewed_at))}</td>

        <td>${escapeHtml(formatDate(item.replied_at))}</td>

        <td>${escapeHtml(item.error_message || "—")}</td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll("[data-customer-id]").forEach(input => {
    input.addEventListener("change", () => {
      const id = Number(input.dataset.customerId);

      if (input.checked) {
        selectedCustomerIds.add(id);
      } else {
        selectedCustomerIds.delete(id);
      }

      updateSelectionCount();
    });
  });

  const visibleIds = filtered.map(item => Number(item.customer_id));

  $("select-visible").checked =
    visibleIds.length > 0 &&
    visibleIds.every(id => selectedCustomerIds.has(id));

  updateSelectionCount();
}

function updateSelectionCount() {
  $("selection-count").textContent =
    `Đã chọn ${selectedCustomerIds.size} khách`;
}

// Chọn bộ lọc trạng thái.
$("status-filters").addEventListener("click", event => {
  const button = event.target.closest("[data-filter]");

  if (!button) return;

  activeFilter = button.dataset.filter;

  $("status-filters")
    .querySelectorAll("[data-filter]")
    .forEach(item => {
      item.classList.toggle("active", item === button);
    });

  renderRecipients();
});

// Tìm kiếm khách hàng.
$("search-customer").addEventListener("input", () => {
  renderRecipients();
});

// Chọn hoặc bỏ chọn toàn bộ khách đang hiển thị.
$("select-visible").addEventListener("change", () => {
  const visible = getFilteredRecipients();

  for (const item of visible) {
    const id = Number(item.customer_id);

    if ($("select-visible").checked) {
      selectedCustomerIds.add(id);
    } else {
      selectedCustomerIds.delete(id);
    }
  }

  renderRecipients();
});

// Tạo chiến dịch chăm sóc lại từ danh sách đã chọn.
$("create-followup").addEventListener("click", () => {
  if (!selectedCustomerIds.size) {
    $("page-message").textContent =
      "Hãy chọn ít nhất một khách hàng trước khi tạo chiến dịch.";
    return;
  }

  const params = new URLSearchParams({
    customerIds: [...selectedCustomerIds].join(","),
    sourceCampaignId: String(campaign.id)
  });

  window.location.href = `/campaigns?${params.toString()}`;
});

// Đăng xuất.
$("logout-btn").addEventListener("click", async () => {
  try {
    await fetch("/api/zalo/logout", {
      method: "POST",
      credentials: "same-origin"
    });
  } finally {
    window.location.href = "/";
  }
});

loadCampaignDetail();