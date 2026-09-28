const qrBox = document.getElementById("qr-box");
const qrImage = document.getElementById("qr-image");
const statusEl = document.getElementById("status");
const loginBtn = document.getElementById("login-btn");

let pollTimer = null;

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = `status ${kind}`;
}

async function checkExistingSession() {
  const response = await fetch("/api/zalo/status");
  const data = await response.json();

  if (data.authenticated) {
    window.location.href = "/dashboard";
    return true;
  }

  loginBtn.disabled = false;
  setStatus("Chưa có phiên Zalo. Bấm nút để tạo QR.");
  return false;
}

async function startQr() {
  loginBtn.disabled = true;
  qrBox.classList.add("hidden");
  setStatus("Đang tạo mã QR...");

  const response = await fetch("/api/zalo/login/qr", {
    method: "POST",
    headers: { "Content-Type": "application/json" }
  });

  const data = await response.json();

  if (!response.ok) {
    setStatus(data.message || "Không thể tạo QR.", "error");
    loginBtn.disabled = false;
    return;
  }

  pollStatus();
}

async function pollStatus() {
  clearInterval(pollTimer);

  pollTimer = setInterval(async () => {
    try {
      const response = await fetch("/api/zalo/login/qr/status", {
        credentials: "include"
      });

      const data = await response.json();

      switch (data.status) {
        case "QR_READY":
          qrBox.classList.remove("hidden");
          qrImage.src = `/api/zalo/login/qr/image?t=${Date.now()}`;
          setStatus(data.message);
          break;

        case "SCANNED":
        case "AUTHENTICATED":
          setStatus(data.message);
          break;

        case "CONNECTED": {
          clearInterval(pollTimer);
          setStatus("Đăng nhập thành công. Đang chuyển đến Dashboard...");

          // Tạo session cho trình duyệt
          const claimResponse = await fetch(
            "/api/zalo/session/claim",
            {
              method: "POST",
              credentials: "include",
              headers: {
                "Content-Type": "application/json"
              }
            }
          );

          if (!claimResponse.ok) {
            throw new Error(
              `Không thể tạo session: HTTP ${claimResponse.status}`
            );
          }

          const claimData = await claimResponse.json();

          console.log("Session:", claimData);

          // Chuyển sang Dashboard
          window.location.replace("/dashboard");

          break;
        }

        case "EXPIRED":
        case "DECLINED":
        case "ERROR":
          clearInterval(pollTimer);

          setStatus(
            data.error || data.message || "QR không hợp lệ.",
            "error"
          );

          loginBtn.disabled = false;
          break;
      }
    } catch (error) {
      console.error("Lỗi kiểm tra trạng thái đăng nhập:", error);
      clearInterval(pollTimer);
      setStatus(
        "Có lỗi khi hoàn tất đăng nhập. Vui lòng thử lại.",
        "error"
      );
      loginBtn.disabled = false;
    }
  }, 1000);
}

loginBtn.addEventListener("click", startQr);
checkExistingSession();
