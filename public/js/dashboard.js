async function loadDashboard() {
  const response = await fetch("/api/dashboard/stats");
  if (response.status === 401) {
    window.location.href = "/";
    return;
  }

  const data = await response.json();

  document.getElementById("total-customers").textContent = data.totalCustomers;
  document.getElementById("today-customers").textContent = data.customersToday;
  document.getElementById("zalo-name").textContent = data.account?.zalo_name || data.account?.zalo_user_id || "-";

  const status = document.getElementById("account-status");
  status.textContent = data.account?.status || "UNKNOWN";
  status.className = `badge ${String(data.account?.status).toLowerCase()}`;
}

async function loadCustomers() {
  const response = await fetch("/api/dashboard/customers");
  if (response.status === 401) {
    window.location.href = "/";
    return;
  }

  const customers = await response.json();
  const tbody = document.getElementById("customer-list");

  if (!customers.length) {
    tbody.innerHTML = `<tr><td colspan="4">Chưa có khách hàng nào tương tác.</td></tr>`;
    return;
  }

  tbody.innerHTML = customers.map(customer => `
    <tr>
      <td>${escapeHtml(customer.display_name || "Chưa xác định")}</td>
      <td>${escapeHtml(customer.zalo_user_id)}</td>
      <td>${escapeHtml(customer.phone || "Chưa có")}</td>
      <td>${escapeHtml(formatDate(customer.last_interaction_at))}</td>
    </tr>
  `).join("");
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("vi-VN");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

document.getElementById("logout-btn").addEventListener("click", async () => {
  await fetch("/api/zalo/logout", { method: "POST" });
  window.location.href = "/";
});

loadDashboard();
loadCustomers();
setInterval(loadDashboard, 5000);
setInterval(loadCustomers, 5000);
