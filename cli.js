#!/usr/bin/env node
const { analyze, formatReport } = require("./index.js");

const dir = process.argv[2] || ".";
const result = analyze(dir);
console.log(formatReport(result));

if (result.verdict === "bloated") process.exit(1);
