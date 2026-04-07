"use strict";

import path from "path";
import express from "express";
import { fileURLToPath } from "url";
import { seedTransactions, seedAutomations } from "./data/seed-data.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ---- Static assets ----
// Put CSS/JS/images into webapp/public
app.use(express.static(path.join(__dirname, "public")));

let transactions = [...seedTransactions];
let automations = [...seedAutomations];

function sendView(res, filename) {
    return res.sendFile(path.join(__dirname, "views", filename));
}

function sortTransactionsNewestFirst(rows) {
    return [...rows].sort((a, b) => {
        if (a.date < b.date) return 1;
        if (a.date > b.date) return -1;
        return 0;
    });
}

function computeTotals(rows) {
    let income = 0;
    let expense = 0;

    for (const row of rows) {
        const amount = Number(row.amount) || 0;
        if (row.type === "income") income += amount;
        if (row.type === "expense") expense += amount;
    }

    return {
        income,
        expense,
        net: income - expense
    };
}

function computeByCategory(rows) {
    const map = new Map();

    for (const row of rows) {
        const category = row.category || "Uncategorised";

        if (!map.has(category)) {
            map.set(category, {
                category,
                income: 0,
                expense: 0,
                net: 0
            });
        }

        const entry = map.get(category);
        const amount = Number(row.amount) || 0;

        if (row.type === "income") entry.income += amount;
        if (row.type === "expense") entry.expense += amount;

        entry.net = entry.income - entry.expense;
    }

    return [...map.values()].sort((a, b) => a.category.localeCompare(b.category));
}

// ---- Pages ----
// Keep "/" on your existing landing page, or switch it to syncx-landing.html if you want that as the homepage.
app.get("/", (req, res) => sendView(res, "elvora.html"));

app.get("/landing", (req, res) => sendView(res, "landing.html"));
app.get("/syncx", (req, res) => sendView(res, "syncx.html"));
app.get("/colour", (req, res) => sendView(res, "colour.html"));
app.get("/elvora", (req, res) => sendView(res, "elvora.html"));
app.get("/overview", (req, res) => sendView(res, "overview.html"));
app.get("/kpi", (req, res) => sendView(res, "kpi.html"));
app.get("/transactions", (req, res) => sendView(res, "transactions.html"));
app.get("/automation", (req, res) => sendView(res, "automation.html"));
app.get("/visualizations", (req, res) => sendView(res, "visualizations.html"));



// Optional aliases
app.get("/home", (req, res) => res.redirect("/"));
app.get("/syncx-landing", (req, res) => res.redirect("/syncx"));

// ---- Health ----
app.get("/health", (req, res) => {
    res.status(200).json({ ok: true });
});

// ---- Overview API ----
app.get("/api/overview", (req, res) => {
    const rows = sortTransactionsNewestFirst(transactions);
    const totals = computeTotals(rows);

    res.json({
        stats: {
            transactionCount: rows.length,
            activeAutomations: automations.filter((a) => a.enabled).length
        },
        totals,
        latestTransactions: rows.slice(0, 5)
    });
});

// ---- KPI API ----
app.get("/api/kpi", (req, res) => {
    const rows = sortTransactionsNewestFirst(transactions);
    const totals = computeTotals(rows);
    const byCategory = computeByCategory(rows);

    res.json({
        totals,
        byCategory
    });
});

// ---- Transactions API ----
app.get("/api/transactions", (req, res) => {
    const rows = sortTransactionsNewestFirst(transactions);
    res.json({
        items: rows
    });
});

app.post("/api/transactions", (req, res) => {
    const { date, description, category, type, amount } = req.body;

    if (!date || !description || !type || amount === undefined || amount === null || amount === "") {
        return res.status(400).json({
            error: "Date, description, type, and amount are required"
        });
    }

    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount)) {
        return res.status(400).json({
            error: "Amount must be a valid number"
        });
    }

    const row = {
        id: `TX-${10000 + transactions.length + 1}`,
        date,
        description,
        category: category || "Uncategorised",
        type: type === "expense" ? "expense" : "income",
        amount: Math.abs(numericAmount)
    };

    transactions.unshift(row);
    res.status(201).json(row);
});

app.delete("/api/transactions/:id", (req, res) => {
    const before = transactions.length;
    transactions = transactions.filter((t) => t.id !== req.params.id);

    if (transactions.length === before) {
        return res.status(404).json({ error: "Transaction not found" });
    }

    res.json({ ok: true });
});

// ---- Automations API ----
app.get("/api/automations", (req, res) => {
    res.json({
        items: automations
    });
});

app.post("/api/automations", (req, res) => {
    const { name, schedule } = req.body;

    if (!name || !schedule) {
        return res.status(400).json({
            error: "Name and schedule are required"
        });
    }

    const row = {
        id: `AUTO-${String(automations.length + 1).padStart(3, "0")}`,
        name,
        schedule,
        enabled: true
    };

    automations.unshift(row);
    res.status(201).json(row);
});

app.patch("/api/automations/:id", (req, res) => {
    const item = automations.find((a) => a.id === req.params.id);

    if (!item) {
        return res.status(404).json({ error: "Automation not found" });
    }

    if (typeof req.body.enabled !== "boolean") {
        return res.status(400).json({
            error: "enabled must be true or false"
        });
    }

    item.enabled = req.body.enabled;
    res.json(item);
});

app.delete("/api/automations/:id", (req, res) => {
    const before = automations.length;
    automations = automations.filter((a) => a.id !== req.params.id);

    if (automations.length === before) {
        return res.status(404).json({ error: "Automation not found" });
    }

    res.json({ ok: true });
});

// ---- 404 ----
app.use((req, res) => {
    res.status(404).send(`Not Found: ${req.originalUrl}`);
});

// ---- Error handler ----
app.use((err, req, res, next) => {
    console.error("Server error:", err);
    res.status(500).send("Internal Server Error");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Server running on http://0.0.0.0:${PORT}`);
});