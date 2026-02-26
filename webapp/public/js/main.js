
function money(n) {
    const x = Number(n);
    if (!Number.isFinite(x)) return "-";
    return x.toLocaleString(undefined, { style: "currency", currency: "EUR" });
}

function $(sel) {
    return document.querySelector(sel);
}

function toast(msg) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    window.clearTimeout(window.__toastTimer);
    window.__toastTimer = window.setTimeout(() => el.classList.remove("show"), 2600);
}

async function api(url, opts) {
    const res = await fetch(url, {
        headers: { "Content-Type": "application/json" },
        ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const msg = data?.error || `Request failed (${res.status})`;
        throw new Error(msg);
    }
    return data;
}

function setActiveNav() {
    const page = document.body.dataset.page;
    const links = document.querySelectorAll("[data-nav]");
    links.forEach((a) => {
        if (a.dataset.nav === page) a.classList.add("active");
    });
}

// ------------------
// Overview page
// ------------------
async function initOverview() {
    const outStats = $("#overviewStats");
    const outLatest = $("#latestTransactions");

    const data = await api("/api/overview");
    const { stats, totals, latestTransactions } = data;

    outStats.innerHTML = `
    <div class="kpi-row">
      <div class="kpi"><div class="label">Total Income</div><div class="value">${money(totals.income)}</div></div>
      <div class="kpi"><div class="label">Total Expense</div><div class="value">${money(totals.expense)}</div></div>
      <div class="kpi"><div class="label">Net</div><div class="value">${money(totals.net)}</div></div>
    </div>
    <div style="height:12px"></div>
    <div class="inline">
      <span class="badge">Transactions: ${stats.transactionCount}</span>
      <span class="badge">Active automations: ${stats.activeAutomations}</span>
    </div>
  `;

    outLatest.innerHTML = latestTransactions
        .map(
            (t) => `
      <tr>
        <td>${t.date}</td>
        <td>${t.description}</td>
        <td>${t.category}</td>
        <td>${t.type}</td>
        <td>${money(t.amount)}</td>
      </tr>
    `
        )
        .join("");
}

// ------------------
// KPI page
// ------------------
async function initKpi() {
    const totalsEl = $("#kpiTotals");
    const tableBody = $("#kpiByCategory");

    const data = await api("/api/kpi");
    const { totals, byCategory } = data;

    totalsEl.innerHTML = `
    <div class="kpi-row">
      <div class="kpi"><div class="label">Income</div><div class="value">${money(totals.income)}</div></div>
      <div class="kpi"><div class="label">Expense</div><div class="value">${money(totals.expense)}</div></div>
      <div class="kpi"><div class="label">Net</div><div class="value">${money(totals.net)}</div></div>
    </div>
  `;

    tableBody.innerHTML = byCategory
        .map(
            (r) => `
      <tr>
        <td>${r.category}</td>
        <td>${money(r.income)}</td>
        <td>${money(r.expense)}</td>
        <td>${money(r.net)}</td>
      </tr>
    `
        )
        .join("");
}

// ------------------
// Transactions page
// ------------------
async function renderTransactions() {
    const tbody = $("#txTableBody");
    const data = await api("/api/transactions");
    tbody.innerHTML = data.items
        .map(
            (t) => `
      <tr>
        <td>${t.date}</td>
        <td>${t.description}</td>
        <td>${t.category}</td>
        <td>${t.type}</td>
        <td>${money(t.amount)}</td>
        <td>
          <button class="btn danger" data-del-tx="${t.id}">Delete</button>
        </td>
      </tr>
    `
        )
        .join("");

    // Wire delete
    document.querySelectorAll("[data-del-tx]").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const id = btn.getAttribute("data-del-tx");
            try {
                await api(`/api/transactions/${id}`, { method: "DELETE" });
                toast("Transaction deleted");
                await renderTransactions();
            } catch (e) {
                toast(e.message);
            }
        });
    });
}

async function initTransactions() {
    const form = $("#txForm");
    await renderTransactions();

    form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const payload = {
            date: $("#txDate").value,
            description: $("#txDescription").value,
            amount: $("#txAmount").value,
            type: $("#txType").value,
            category: $("#txCategory").value,
        };

        try {
            await api("/api/transactions", {
                method: "POST",
                body: JSON.stringify(payload),
            });
            form.reset();
            toast("Transaction added");
            await renderTransactions();
        } catch (e) {
            toast(e.message);
        }
    });
}

// ------------------
// Automation page
// ------------------
async function renderAutomations() {
    const tbody = $("#autoTableBody");
    const data = await api("/api/automations");

    tbody.innerHTML = data.items
        .map(
            (a) => `
      <tr>
        <td>${a.name}</td>
        <td>${a.schedule}</td>
        <td>${a.enabled ? "Enabled" : "Disabled"}</td>
        <td class="inline">
          <button class="btn" data-toggle-auto="${a.id}" data-enabled="${a.enabled}">
            ${a.enabled ? "Disable" : "Enable"}
          </button>
          <button class="btn danger" data-del-auto="${a.id}">Delete</button>
        </td>
      </tr>
    `
        )
        .join("");

    document.querySelectorAll("[data-toggle-auto]").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const id = btn.getAttribute("data-toggle-auto");
            const current = btn.getAttribute("data-enabled") === "true";
            try {
                await api(`/api/automations/${id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ enabled: !current }),
                });
                toast("Automation updated");
                await renderAutomations();
            } catch (e) {
                toast(e.message);
            }
        });
    });

    document.querySelectorAll("[data-del-auto]").forEach((btn) => {
        btn.addEventListener("click", async () => {
            const id = btn.getAttribute("data-del-auto");
            try {
                await api(`/api/automations/${id}`, { method: "DELETE" });
                toast("Automation deleted");
                await renderAutomations();
            } catch (e) {
                toast(e.message);
            }
        });
    });
}

async function initAutomation() {
    const form = $("#autoForm");
    await renderAutomations();

    form.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const payload = {
            name: $("#autoName").value,
            schedule: $("#autoSchedule").value,
        };

        try {
            await api("/api/automations", {
                method: "POST",
                body: JSON.stringify(payload),
            });
            form.reset();
            toast("Automation added");
            await renderAutomations();
        } catch (e) {
            toast(e.message);
        }
    });
}

// ------------------
// Boot
// ------------------
(async function boot() {
    setActiveNav();

    const page = document.body.dataset.page;
    try {
        if (page === "overview") await initOverview();
        if (page === "kpi") await initKpi();
        if (page === "transactions") await initTransactions();
        if (page === "automation") await initAutomation();
    } catch (e) {
        toast(e.message || "Something went wrong");
        console.error(e);
    }
})();