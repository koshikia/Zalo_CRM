const $ = (id) => document.getElementById(id);

let campaigns = [];
let customers = [];
let selectedCustomerIds = new Set();
let editingCampaignId = null;

const statusLabels = {
  DRAFT: "Bản nháp",
  SCHEDULED: "Đã lên lịch",
  RUNNING: "Đang chạy",
  COMPLETED: "Hoàn thành",
  CANCELLED: "Đã hủy"
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
    throw new Error(data.message || "Có lỗi xảy ra.");
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
  if (!value) return "Chưa đặt";

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("vi-VN");
}

function number(value) {
  return Number(value || 0).toLocaleString("vi-VN");
}

async function loadAll() {
  try {
    [campaigns, customers] = await Promise.all([
      api("/api/campaigns"),
      api("/api/campaigns/customers")
    ]);

    renderCampaigns();
    renderCustomerPicker();
    renderSummary();
  } catch (error) {
    const tbody = $("campaign-list");

    if (tbody) {
      tbody.innerHTML = `
        <tr>
          <td colspan="9">${escapeHtml(error.message)}</td>
        </tr>
      `;
    }
  }
}

function renderSummary() {
  $("summary-total").textContent = campaigns.length;

  $("summary-sent").textContent = number(
    campaigns.reduce(
      (total, campaign) =>
        total + Number(campaign.sent_count || 0),
      0
    )
  );

  $("summary-replied").textContent = number(
    campaigns.reduce(
      (total, campaign) =>
        total + Number(campaign.replied_count || 0),
      0
    )
  );

  $("summary-unread").textContent = number(
    campaigns.reduce(
      (total, campaign) =>
        total + Number(campaign.not_viewed_count || 0),
      0
    )
  );
}

// Hiển thị danh sách chiến dịch và nút gửi
function renderCampaigns() {
  const query = $("search-campaign").value.trim().toLowerCase();
  const status = $("status-filter").value;

  const filtered = campaigns.filter((campaign) =>
    String(campaign.name || "").toLowerCase().includes(query) &&
    (!status || campaign.status === status)
  );

  const tbody = $("campaign-list");

  if (!filtered.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" class="empty-state">
          Chưa có chiến dịch phù hợp.
          Bấm “Tạo chiến dịch” để bắt đầu.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = filtered.map((campaign) => {
    const canEdit = ["DRAFT", "SCHEDULED"].includes(
      campaign.status
    );

    const sendButton = canEdit
      ? `
        <button
          type="button"
          class="primary-btn btn-send-campaign"
          data-campaign-id="${Number(campaign.id)}"
        >
          Gửi chiến dịch
        </button>
      `
      : "";

    const editDeleteButtons = `
  <button
    type="button"
    class="secondary-btn"
    data-detail="${Number(campaign.id)}"
  >
    Chi tiết
  </button>

  ${
    canEdit
      ? `
        <button
          type="button"
          class="secondary-btn"
          data-edit="${Number(campaign.id)}"
        >
          Sửa
        </button>

        <button
          type="button"
          class="danger-btn"
          data-delete="${Number(campaign.id)}"
        >
          Xóa
        </button>
      `
      : ""
  }
`;

    return `
      <tr>
        <td>
          <div class="campaign-name">
            ${escapeHtml(campaign.name)}
          </div>

          <div class="campaign-preview">
            ${escapeHtml(campaign.content)}
          </div>
        </td>

        <td>
          <span class="status-pill status-${escapeHtml(
            String(campaign.status || "").toLowerCase()
          )}">
            ${escapeHtml(
              statusLabels[campaign.status] || campaign.status
            )}
          </span>
        </td>

        <td>${number(campaign.total_recipients)}</td>
        <td>${number(campaign.replied_count)}</td>
        <td>${number(campaign.viewed_count)}</td>
        <td>${number(campaign.not_viewed_count)}</td>
        <td>${number(campaign.failed_count)}</td>

        <td>
          ${escapeHtml(formatDate(campaign.scheduled_at))}

          <div class="campaign-preview">
            Cách nhau ${number(campaign.interval_seconds)} giây
          </div>
        </td>

        <td>
          <div class="row-actions">
            ${sendButton}
            ${editDeleteButtons}
          </div>
        </td>
      </tr>
    `;
  }).join("");

  tbody.querySelectorAll("[data-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      openEditor(Number(button.dataset.edit));
    });
  });

  tbody.querySelectorAll("[data-delete]").forEach((button) => {
    button.addEventListener("click", () => {
      deleteCampaign(Number(button.dataset.delete));
    });
  });

  tbody.querySelectorAll("[data-detail]").forEach((button) => {
    button.addEventListener("click", () => {
      showCampaignDetail(Number(button.dataset.detail));
    });
  });
}

// Hiển thị danh sách khách hàng để lựa chọn
function renderCustomerPicker() {
  const query = $("search-customer").value.trim().toLowerCase();

  const filtered = customers.filter((customer) =>
    `${customer.display_name || ""} ${
      customer.phone || ""
    } ${customer.zalo_user_id || ""}`
      .toLowerCase()
      .includes(query)
  );

  $("customer-count").textContent =
    `${filtered.length} khách hàng`;

  $("selected-count").textContent =
    `${selectedCustomerIds.size} khách được chọn`;

  $("select-all").checked =
    filtered.length > 0 &&
    filtered.every((customer) =>
      selectedCustomerIds.has(Number(customer.id))
    );

  if (!filtered.length) {
    $("customer-picker").innerHTML = `
      <div class="empty-state">
        Không tìm thấy khách hàng.
        Khách hàng cần tương tác với tài khoản Zalo
        trước để xuất hiện ở đây.
      </div>
    `;
    return;
  }

  $("customer-picker").innerHTML = filtered.map((customer) => `
    <label class="customer-option">
      <input
        type="checkbox"
        data-customer="${Number(customer.id)}"
        ${
          selectedCustomerIds.has(Number(customer.id))
            ? "checked"
            : ""
        }
      >

      <span class="customer-meta">
        <strong>
          ${escapeHtml(
            customer.display_name || "Chưa xác định tên"
          )}
        </strong>

        <small>
          ${escapeHtml(customer.phone || "Chưa có số điện thoại")}
          · Zalo ID:
          ${escapeHtml(customer.zalo_user_id || "Không có")}
        </small>
      </span>
    </label>
  `).join("");

  $("customer-picker")
    .querySelectorAll("[data-customer]")
    .forEach((input) => {
      input.addEventListener("change", () => {
        const id = Number(input.dataset.customer);

        if (input.checked) {
          selectedCustomerIds.add(id);
        } else {
          selectedCustomerIds.delete(id);
        }

        $("selected-count").textContent =
          `${selectedCustomerIds.size} khách được chọn`;

        $("select-all").checked =
          filtered.length > 0 &&
          filtered.every((customer) =>
            selectedCustomerIds.has(Number(customer.id))
          );
      });
    });
}

// Mở form tạo hoặc sửa chiến dịch
function openEditor(id = null, preselectedIds = []) {
  editingCampaignId = id;

  selectedCustomerIds = new Set(
    preselectedIds
      .map(Number)
      .filter(Number.isSafeInteger)
  );

  $("campaign-form").reset();
  $("campaign-id").value = id || "";
  $("delay-minutes").value = 0;
  $("interval-seconds").value = 10;
  $("form-message").textContent = "";
  $("form-message").className = "form-message";

  $("editor-title").textContent =
    id ? "Sửa chiến dịch" : "Tạo chiến dịch";

  $("save-campaign").textContent =
    id ? "Lưu thay đổi" : "Lưu chiến dịch";

  const fill = async () => {
    if (id) {
      const campaign = await api(`/api/campaigns/${id}`);

      $("campaign-name").value = campaign.name || "";
      $("campaign-content").value = campaign.content || "";
      $("delay-minutes").value = campaign.delay_minutes ?? 0;
      $("interval-seconds").value =
        campaign.interval_seconds ?? 10;

      selectedCustomerIds = new Set(
        (campaign.customerIds || []).map(Number)
      );
    }

    renderCustomerPicker();
    $("editor-backdrop").classList.remove("hidden");
  };

  fill().catch(error => alert(error.message));
}

function closeEditor() {
  $("editor-backdrop").classList.add("hidden");
}

// Lưu chiến dịch
async function saveCampaign(event) {
  event.preventDefault();

  const payload = {
    name: $("campaign-name").value.trim(),
    content: $("campaign-content").value.trim(),
    delayMinutes: Number($("delay-minutes").value),
    intervalSeconds: Number($("interval-seconds").value),
    customerIds: [...selectedCustomerIds]
  };

  $("save-campaign").disabled = true;
  $("form-message").textContent = "Đang lưu...";

  try {
    const url = editingCampaignId
      ? `/api/campaigns/${editingCampaignId}`
      : "/api/campaigns";

    await api(url, {
      method: editingCampaignId ? "PUT" : "POST",
      body: JSON.stringify(payload)
    });

    $("form-message").textContent = "Đã lưu chiến dịch.";
    $("form-message").className = "form-message success";

    closeEditor();
    await loadAll();
  } catch (error) {
    $("form-message").textContent = error.message;
    $("form-message").className = "form-message";
  } finally {
    $("save-campaign").disabled = false;
  }
}

// Xóa chiến dịch
async function deleteCampaign(id) {
  const campaign = campaigns.find(
    (item) => Number(item.id) === id
  );

  if (
    !campaign ||
    !confirm(
      `Bạn có chắc muốn xóa chiến dịch "${campaign.name}"?`
    )
  ) {
    return;
  }

  try {
    await api(`/api/campaigns/${id}`, {
      method: "DELETE"
    });

    await loadAll();
  } catch (error) {
    alert(error.message);
  }
}

// Xem thông tin chiến dịch
function showCampaignDetail(id) {
  window.location.href = `/campaigns/${encodeURIComponent(id)}`;
}

// Gửi chiến dịch qua API backend
async function sendCampaign(campaignId, button) {
  const campaign = campaigns.find(
    (item) => Number(item.id) === Number(campaignId)
  );

  if (!campaign) {
    alert("Không tìm thấy chiến dịch.");
    return;
  }

  const confirmed = confirm(
    `Bạn có chắc muốn gửi chiến dịch "${campaign.name}" ` +
    `đến các khách hàng đã chọn không?\n\n` +
    "Hãy kiểm tra nội dung và danh sách khách hàng trước khi xác nhận."
  );

  if (!confirmed) return;

  const originalText = button.textContent;

  button.disabled = true;
  button.textContent = "Đang gửi...";

  try {
    const result = await api(
      `/api/campaigns/${encodeURIComponent(campaignId)}/send`,
      {
        method: "POST"
      }
    );
    window.location.href = `/campaigns/${encodeURIComponent(campaignId)}`;
    return;
  } catch (error) {
    alert(error.message || "Có lỗi xảy ra khi gửi chiến dịch.");
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

// Các sự kiện giao diện
$("new-campaign").addEventListener("click", () => openEditor());

$("close-editor").addEventListener("click", closeEditor);

$("cancel-editor").addEventListener("click", closeEditor);

$("editor-backdrop").addEventListener("click", (event) => {
  if (event.target === $("editor-backdrop")) {
    closeEditor();
  }
});

$("campaign-form").addEventListener("submit", saveCampaign);

$("search-campaign").addEventListener("input", renderCampaigns);

$("status-filter").addEventListener("change", renderCampaigns);

$("search-customer").addEventListener(
  "input",
  renderCustomerPicker
);

// Chọn hoặc bỏ chọn tất cả khách hàng đang hiển thị
$("select-all").addEventListener("change", () => {
  const query = $("search-customer").value.trim().toLowerCase();

  customers
    .filter((customer) =>
      `${customer.display_name || ""} ${
        customer.phone || ""
      } ${customer.zalo_user_id || ""}`
        .toLowerCase()
        .includes(query)
    )
    .forEach((customer) => {
      if ($("select-all").checked) {
        selectedCustomerIds.add(Number(customer.id));
      } else {
        selectedCustomerIds.delete(Number(customer.id));
      }
    });

  renderCustomerPicker();
});

// Đăng xuất
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

// Bắt sự kiện nút gửi chiến dịch
document.addEventListener("click", (event) => {
  const button = event.target.closest(".btn-send-campaign");

  if (!button) return;

  const campaignId = button.dataset.campaignId;

  if (!campaignId) {
    alert("Không xác định được chiến dịch.");
    return;
  }

  sendCampaign(campaignId, button);
});

// Khởi tạo trang và nhận danh sách khách được chuyển từ trang chi tiết.
async function initCampaignPage() {
  await loadAll();

  const params = new URLSearchParams(window.location.search);
  const customerIdsParam = params.get("customerIds");

  if (!customerIdsParam) return;

  const customerIds = [
    ...new Set(
      customerIdsParam
        .split(",")
        .map(Number)
        .filter(id => Number.isSafeInteger(id) && id > 0)
    )
  ];

  if (!customerIds.length) return;

  // Chỉ giữ các khách hàng thuộc danh sách khách hàng hệ thống đã tải.
  const availableIds = new Set(
    customers.map(customer => Number(customer.id))
  );

  const validIds = customerIds.filter(id => availableIds.has(id));

  if (!validIds.length) {
    alert("Không tìm thấy khách hàng hợp lệ trong danh sách được chọn.");
    return;
  }

  openEditor(null, validIds);

  // Xóa danh sách ID khỏi URL sau khi đã mở form.
  window.history.replaceState(
    {},
    document.title,
    "/campaigns"
  );
}

initCampaignPage();
