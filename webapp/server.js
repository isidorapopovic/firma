const path = require("path");
const express = require("express");
const { randomUUID } = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => console.log(`Listening on ${PORT}`));

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));

// Static assets (CSS/JS)
app.use(express.static(path.join(__dirname, "public")));

const VIEWS_DIR = path.join(__dirname, "views");

// --------------------
// In-memory data store
// (Later we can replace with SQLite/Postgres/etc.)
// --------------------
let transactions = [
    {
        id: randomUUID(),
        date: "2026-02-20",
        description: "Invoice #1024",
        amount: 1250.0,
        type: "income",
        category: "Sales",
    },
    {
        id: randomUUID(),
        date: "2026-02-21",
        description: "Office rent",
        amount: 480.0,
        type: "expense",
        category: "Operations",
    },
    {
        id: randomUUID(),
        date: "2026-02-23",
        description: "Consulting",
        amount: 900.0,
        type: "income",
        category: "Services",
    },
];

let automations = [
    {
        id: randomUUID(),
        name: "Daily Sales Sync",
        schedule: "Every day at 08:00",
        enabled: true,
    },
    {
        id: randomUUID(),
        name: "Weekly KPI Report",
        schedule: "Every Monday at 09:00",
        enabled: true,
    },
    {
        id: randomUUID(),
        name: "Transaction Anomaly Check",
        schedule: "Every day at 18:00",
        enabled: false,
    },
];

// --------------------
// Helpers
// --------------------
function isValidISODate(dateStr) {
    return /^\d{4}-\d{2}-\d{2}$/.test(dateStr) && !Number.isNaN(new Date(dateStr).getTime());
}

function computeKpis() {
    const income = transactions
        .filter((t) => t.type === "income")
        .reduce((sum, t) => sum + t.amount, 0);

    const expense = transactions
        .filter((t) => t.type === "expense")
        .reduce((sum, t) => sum + t.amount, 0);

    const net = income - expense;

    const byCategory = {};
    for (const t of transactions) {
        const key = t.category || "Uncategorized";
        if (!byCategory[key]) {
            byCategory[key] = { income: 0, expense: 0, net: 0 };
        }
        if (t.type === "income") byCategory[key].income += t.amount;
        if (t.type === "expense") byCategory[key].expense += t.amount;
        byCategory[key].net = byCategory[key].income - byCategory[key].expense;
    }

    // Sort categories by absolute net (descending)
    const categoryRows = Object.entries(byCategory)
        .map(([category, v]) => ({ category, ...v }))
        .sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

    return {
        totals: {
            income: Number(income.toFixed(2)),
            expense: Number(expense.toFixed(2)),
            net: Number(net.toFixed(2)),
        },
        byCategory: categoryRows,
    };
}

function computeOverview() {
    const kpi = computeKpis();
    const activeAutomations = automations.filter((a) => a.enabled).length;

    // latest 5 transactions by date desc
    const latest = [...transactions].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);

    return {
        stats: {
            transactionCount: transactions.length,
            activeAutomations,
        },
        totals: kpi.totals,
        latestTransactions: latest,
    };
}

// --------------------
// Page routes (HTML)
// --------------------
app.get("/", (_, res) => res.sendFile(path.join(VIEWS_DIR, "index.html")));
app.get("/overview", (_, res) => res.sendFile(path.join(VIEWS_DIR, "overview.html")));
app.get("/kpi", (_, res) => res.sendFile(path.join(VIEWS_DIR, "kpi.html")));
app.get("/transactions", (_, res) => res.sendFile(path.join(VIEWS_DIR, "transactions.html")));
app.get("/automation", (_, res) => res.sendFile(path.join(VIEWS_DIR, "automation.html")));

// ✅ NEW PAGE ROUTE
app.get("/visualizations", (_, res) =>
    res.sendFile(path.join(VIEWS_DIR, "visualizations.html"))
);

// --------------------
// API routes (JSON)
// --------------------

// Overview
app.get("/api/overview", (_, res) => {
    res.json(computeOverview());
});

// KPI
app.get("/api/kpi", (_, res) => {
    res.json(computeKpis());
});

// Transactions CRUD
app.get("/api/transactions", (_, res) => {
    const items = [...transactions].sort((a, b) => new Date(b.date) - new Date(a.date));
    res.json({ items });
});

app.post("/api/transactions", (req, res) => {
    const { date, description, amount, type, category } = req.body;

    if (!date || !isValidISODate(date)) {
        return res.status(400).json({ error: "date must be YYYY-MM-DD" });
    }
    if (!description || String(description).trim().length < 2) {
        return res.status(400).json({ error: "description is required" });
    }
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ error: "amount must be a positive number" });
    }
    if (type !== "income" && type !== "expense") {
        return res.status(400).json({ error: "type must be 'income' or 'expense'" });
    }

    const item = {
        id: randomUUID(),
        date,
        description: String(description).trim(),
        amount: Number(parsedAmount.toFixed(2)),
        type,
        category: String(category || "Uncategorized").trim() || "Uncategorized",
    };

    transactions.push(item);
    res.status(201).json({ item });
});

app.delete("/api/transactions/:id", (req, res) => {
    const { id } = req.params;
    const before = transactions.length;
    transactions = transactions.filter((t) => t.id !== id);
    if (transactions.length === before) {
        return res.status(404).json({ error: "Transaction not found" });
    }
    res.json({ ok: true });
});

// Automations CRUD-ish
app.get("/api/automations", (_, res) => {
    const items = [...automations];
    res.json({ items });
});

app.post("/api/automations", (req, res) => {
    const { name, schedule } = req.body;

    if (!name || String(name).trim().length < 2) {
        return res.status(400).json({ error: "name is required" });
    }
    if (!schedule || String(schedule).trim().length < 2) {
        return res.status(400).json({ error: "schedule is required" });
    }

    const item = {
        id: randomUUID(),
        name: String(name).trim(),
        schedule: String(schedule).trim(),
        enabled: true,
    };

    automations.push(item);
    res.status(201).json({ item });
});

app.patch("/api/automations/:id", (req, res) => {
    const { id } = req.params;
    const idx = automations.findIndex((a) => a.id === id);
    if (idx === -1) return res.status(404).json({ error: "Automation not found" });

    const { enabled } = req.body;
    if (typeof enabled !== "boolean") {
        return res.status(400).json({ error: "enabled must be boolean" });
    }

    automations[idx].enabled = enabled;
    res.json({ item: automations[idx] });
});

app.delete("/api/automations/:id", (req, res) => {
    const { id } = req.params;
    const before = automations.length;
    automations = automations.filter((a) => a.id !== id);
    if (automations.length === before) {
        return res.status(404).json({ error: "Automation not found" });
    }
    res.json({ ok: true });
});

// --------------------
// 404 / error handlers
// --------------------
app.use((req, res) => {
    if (req.path.startsWith("/api/")) {
        return res.status(404).json({ error: "Not found" });
    }
    res.status(404).send("404 - Page not found");
});

app.listen(PORT, () => {
    console.log(`✅ Web app running: http://localhost:${PORT}`);
});