// ============================================================
// DevTools Guard — Gây khó mở DevTools cho user thường
// Không chặn được 100%, chỉ là lớp bảo vệ cơ bản
// ============================================================

export function initDevToolsGuard() {
  if (typeof window === "undefined") return;

  // 1. Chặn phím tắt F12, Ctrl+Shift+I/J/C, Ctrl+U
  document.addEventListener("keydown", (e) => {
    if (
      e.key === "F12" ||
      (e.ctrlKey && e.shiftKey && ["I", "J", "C"].includes(e.key.toUpperCase())) ||
      (e.ctrlKey && e.key.toUpperCase() === "U")
    ) {
      e.preventDefault();
      e.stopPropagation();
      return false;
    }
  }, true);

  // 2. Chặn right-click (Inspect Element)
  document.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    return false;
  });

  // 3. Detect DevTools mở bằng debugger trick
  // Khi DevTools mở, debugger statement sẽ pause → thời gian chạy > threshold
  const threshold = 160;
  setInterval(() => {
    const start = performance.now();
    // eslint-disable-next-line no-debugger
    debugger;
    const duration = performance.now() - start;
    if (duration > threshold) {
      // DevTools đang mở — có thể redirect hoặc clear page
      document.body.innerHTML = "<div style='display:flex;align-items:center;justify-content:center;height:100vh;font-size:20px;color:#666;font-family:sans-serif'>⚠️ Vui lòng đóng Developer Tools để tiếp tục sử dụng</div>";
    }
  }, 2000);
}
