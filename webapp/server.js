"use strict";

const path = require("path");
const express = require("express");

const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use("/api", require("./routes/api"));

// Static files from public
app.use(express.static(path.join(__dirname, "public")));

// Routes for your HTML pages
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "views", "index.html"));
});

app.get("/overview", (req, res) => {
    res.sendFile(path.join(__dirname, "views", "overview.html"));
});

app.get("/kpi", (req, res) => {
    res.sendFile(path.join(__dirname, "views", "kpi.html"));
});

app.get("/transactions", (req, res) => {
    res.sendFile(path.join(__dirname, "views", "transactions.html"));
});

app.get("/automation", (req, res) => {
    res.sendFile(path.join(__dirname, "views", "automation.html"));
});

app.get("/visualizations", (req, res) => {
    res.sendFile(path.join(__dirname, "views", "visualizations.html"));
});

app.get("/health", (req, res) => {
    res.status(200).json({ ok: true });
});

app.use((req, res) => {
    res.status(404).send(`Not Found: ${req.originalUrl}`);
});

app.use((err, req, res, next) => {
    console.error("Server error:", err);
    res.status(500).send("Internal Server Error");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Server running on port ${PORT}`);
});