---
name: zatca-compliance
description: |
  Validates invoice financial math, automatically calculates 15% VAT, and encodes data into the legal ZATCA TLV Base64 format.
  Use this skill when the user wants to process raw invoice data, calculate taxes, generate secure QR codes, or archive fiscal entries.
  Do NOT use for employee scheduling, general ledger auditing, or non-Saudi tax systems.
version: 1.0.0
license: MIT
allowed-tools: [save_zatca_invoice]
---

# ZATCA Compliance Skill

## When to use
* Use when a raw invoice amount needs to be audited or tax-evaluated.
* Use when generating the cryptographic TLV Base64 string for Saudi Arabian e-invoicing compliance.
* Use when storing completed invoice structures securely into local database systems.

## When NOT to use
* Do NOT trigger for general business accounting or financial forecasting.
* Do NOT use for cross-border international tax calculations.

## Workflow
1. **Intercept Input:** Capture the `supplierName`, `vatNumber`, and `amountBeforeVat`.
2. **Execute Logic:** Call the local MCP tool `save_zatca_invoice` to perform deterministic tax mathematics (base amount * 0.15) to prevent LLM mathematical hallucinations.
3. **Persist & Respond:** Ensure the SQLite database records the transaction and return the structured JSON object containing the legal `qrCodeBase64` payload back to the human operator.

## Examples
- **Input:** "Process an invoice for Blind Invoice MVP with VAT number 311111111111113 and an amount of 500"
- **Output:** `{"success": true, "message": "Invoice securely processed...", "qrCodeBase64": "...", "totalAmount": "575.00"}`

## Anti-Patterns to Avoid
* Never let the LLM guess or manually compute the 15% VAT inside the chat context window; always delegate the math to the underlying deterministic script tool.
