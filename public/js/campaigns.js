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
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401) {
    window.location.href = "/";
    throw new Error("Phiên đăng nhập đã hết hạn.");
  }
  if (!response.ok) throw new Error(data.message || "Có lỗi xảy ra.");
  return data;
}

function escapeHtml(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}
function formatDate(value) {
  if (!value) return "Chưa đặt";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString("vi-VN");
}
function number(value) { return Number(value || 0).toLocaleString("vi-VN"); }

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
    $("campaign-list").innerHTML = `<tr><td colspan="9">${escapeHtml(error.message)}</td></tr>`;
  }
}

function renderSummary() {
  $("summary-total").textContent = campaigns.length;
  $("summary-sent").textContent = number(campaigns.reduce((n, c) => n + Number(c.sent_count || 0), 0));
  $("summary-replied").textContent = number(campaigns.reduce((n, c) => n + Number(c.replied_count || 0), 0));
  $("summary-unread").textContent = number(campaigns.reduce((n, c) => n + Number(c.not_viewed_count || 0), 0));
}

function renderCampaigns() {
  const query = $("search-campaign").value.trim().toLowerCase();
  const status = $("status-filter").value;
  const filtered = campaigns.filter(c =>
    c.name.toLowerCase().includes(query) && (!status || c.status === status)
  );
  const tbody = $("campaign-list");
  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="9" class="empty-state">Chưa có chiến dịch phù hợp. Bấm “Tạo chiến dịch” để bắt đầu.</td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map(c => {
    const canEdit = ["DRAFT", "SCHEDULED"].includes(c.status);
    return `<tr>
      <td><div class="campaign-name">${escapeHtml(c.name)}</div><div class="campaign-preview">${escapeHtml(c.content)}</div></td>
      <td><span class="status-pill status-${String(c.status).toLowerCase()}">${escapeHtml(statusLabels[c.status] || c.status)}</span></td>
      <td>${number(c.total_recipients)}</td>
      <td>${number(c.replied_count)}</td>
      <td>${number(c.viewed_count)}</td>
      <td>${number(c.not_viewed_count)}</td>
      <td>${number(c.failed_count)}</td>
      <td>${escapeHtml(formatDate(c.scheduled_at))}<div class="campaign-preview">Cách nhau ${number(c.interval_seconds)} giây</div></td>
      <td><div class="row-actions">
        ${canEdit ? `<button class="secondary-btn" data-edit="${c.id}">Sửa</button><button class="danger-btn" data-delete="${c.id}">Xóa</button>` : `<button class="secondary-btn" data-detail="${c.id}">Chi tiết</button>`}
      </div></td>
    </tr>`;
  }).join("");
  tbody.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => openEditor(Number(b.dataset.edit))));
  tbody.querySelectorAll("[data-delete]").forEach(b => b.addEventListener("click", () => deleteCampaign(Number(b.dataset.delete))));
  tbody.querySelectorAll("[data-detail]").forEach(b => b.addEventListener("click", () => showCampaignDetail(Number(b.dataset.detail))));
}

function renderCustomerPicker() {
  const query = $("search-customer").value.trim().toLowerCase();
  const filtered = customers.filter(c =>
    `${c.display_name || ""} ${c.phone || ""} ${c.zalo_user_id}`.toLowerCase().includes(query)
  );
  $("customer-count").textContent = `${filtered.length} khách hàng`;
  $("selected-count").textContent = `${selectedCustomerIds.size} khách được chọn`;
  $("select-all").checked = filtered.length > 0 && filtered.every(c => selectedCustomerIds.has(Number(c.id)));
  if (!filtered.length) {
    $("customer-picker").innerHTML = `<div class="empty-state">Không tìm thấy khách hàng. Khách hàng cần tương tác với tài khoản Zalo trước để xuất hiện ở đây.</div>`;
    return;
  }
  $("customer-picker").innerHTML = filtered.map(c => `
    <label class="customer-option">
      <input type="checkbox" data-customer="${Number(c.id)}" ${selectedCustomerIds.has(Number(c.id)) ? "checked" : ""}>
      <span class="customer-meta"><strong>${escapeHtml(c.display_name || "Chưa xác định tên")}</strong>
      <small>${escapeHtml(c.phone || "Chưa có số điện thoại")} · Zalo ID: ${escapeHtml(c.zalo_user_id)}</small></span>
    </label>`).join("");
  $("customer-picker").querySelectorAll("[data-customer]").forEach(input => input.addEventListener("change", () => {
    const id = Number(input.dataset.customer);
    if (input.checked) selectedCustomerIds.add(id);
    else selectedCustomerIds.delete(id);
    $("selected-count").textContent = `${selectedCustomerIds.size} khách được chọn`;
    $("select-all").checked = filtered.length > 0 && filtered.every(c => selectedCustomerIds.has(Number(c.id)));
  }));
}

function openEditor(id = null) {
  editingCampaignId = id;
  selectedCustomerIds = new Set();
  $("campaign-form").reset();
  $("campaign-id").value = id || "";
  $("delay-minutes").value = 0;
  $("interval-seconds").value = 10;
  $("form-message").textContent = "";
  $("form-message").className = "form-message";
  $("editor-title").textContent = id ? "Sửa chiến dịch" : "Tạo chiến dịch";
  $("save-campaign").textContent = id ? "Lưu thay đổi" : "Lưu chiến dịch";
  const fill = async () => {
    if (id) {
      const c = await api(`/api/campaigns/${id}`);
      $("campaign-name").value = c.name;
      $("campaign-content").value = c.content;
      $("delay-minutes").value = c.delay_minutes;
      $("interval-seconds").value = c.interval_seconds;
      selectedCustomerIds = new Set(c.customerIds);
    }
    renderCustomerPicker();
    $("editor-backdrop").classList.remove("hidden");
  };
  fill().catch(e => alert(e.message));
}

function closeEditor() { $("editor-backdrop").classList.add("hidden"); }

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
    const url = editingCampaignId ? `/api/campaigns/${editingCampaignId}` : "/api/campaigns";
    await api(url, { method: editingCampaignId ? "PUT" : "POST", body: JSON.stringify(payload) });
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

async function deleteCampaign(id) {
  const campaign = campaigns.find(c => Number(c.id) === id);
  if (!campaign || !confirm(`Bạn có chắc muốn xóa chiến dịch "${campaign.name}"?`)) return;
  try {
    await api(`/api/campaigns/${id}`, { method: "DELETE" });
    await loadAll();
  } catch (error) { alert(error.message); }
}

function showCampaignDetail(id) {
  const c = campaigns.find(item => Number(item.id) === id);
  if (!c) return;
  alert(`${c.name}\nTrạng thái: ${statusLabels[c.status] || c.status}\nKhách nhận: ${c.total_recipients}\nĐã gửi: ${c.sent_count}\nĐã trả lời: ${c.replied_count}\nĐã xem: ${c.viewed_count}\nChưa xem: ${c.not_viewed_count}\nKhông gửi được: ${c.failed_count}`);
}

$("new-campaign").addEventListener("click", () => openEditor());
$("close-editor").addEventListener("click", closeEditor);
$("cancel-editor").addEventListener("click", closeEditor);
$("editor-backdrop").addEventListener("click", e => { if (e.target === $("editor-backdrop")) closeEditor(); });
$("campaign-form").addEventListener("submit", saveCampaign);
$("search-campaign").addEventListener("input", renderCampaigns);
$("status-filter").addEventListener("change", renderCampaigns);
$("search-customer").addEventListener("input", renderCustomerPicker);
$("select-all").addEventListener("change", () => {
  const query = $("search-customer").value.trim().toLowerCase();
  customers.filter(c => `${c.display_name || ""} ${c.phone || ""} ${c.zalo_user_id}`.toLowerCase().includes(query))
    .forEach(c => $("select-all").checked ? selectedCustomerIds.add(Number(c.id)) : selectedCustomerIds.delete(Number(c.id)));
  renderCustomerPicker();
});
$("logout-btn").addEventListener("click", async () => {
  await fetch("/api/zalo/logout", { method: "POST" });
  window.location.href = "/";
});

loadAll();
