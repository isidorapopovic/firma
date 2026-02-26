// webapp/server.js
"use strict";

const path = require("path");
const express = require("express");

const app = express();

// ---- Basic config ----
app.disable("x-powered-by");

// Render/Express behind proxy (safe default on Render)
app.set("trust proxy", 1);

// ---- View engine (EJS) ----
// Your project uses EJS templates inside /templates
app.set("views", path.join(__dirname, "templates"));
app.set("view engine", "ejs");

// ---- Body parsing (for forms) ----
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// ---- Static assets ----
// Put CSS/JS/images into webapp/public
app.use(express.static(path.join(__dirname, "public")));

// ---- Routes ----

// Home page: try to render landing.ejs if it exists, else show a simple page.
app.get("/", (req, res) => {
    // If you have templates/landing.ejs, this works:
    // res.render("landing");
    // If you prefer a different default, swap it (e.g. "jobs")
    res.render("landing", { title: "Firma WebApp" });
});

// Example: jobs page (only keep if you have templates/jobs.ejs)
app.get("/jobs", (req, res) => {
    res.render("jobs", { title: "Jobs" });
});

// Example: health check endpoint (useful for debugging)
app.get("/health", (req, res) => {
    res.status(200).json({ ok: true });
});

// ---- 404 handler ----
app.use((req, res) => {
    // If you want a custom 404 template, create templates/404.ejs
    // return res.status(404).render("404", { url: req.originalUrl });
    res.status(404).send(`Not Found: ${req.originalUrl}`);
});

// ---- Error handler ----
app.use((err, req, res, next) => {
    console.error("Server error:", err);
    res.status(500).send("Internal Server Error");
});

// ---- Start server ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Server running on port ${PORT}`);
});