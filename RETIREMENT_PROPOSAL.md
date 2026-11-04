# Legacy business-table retirement — proposal awaiting approval

This document does not authorise deletion. No table, locked migration or
customer record is dropped by 5B. Separate user approval is required.

1. Keep the default-off server gate and privacy tests in place. Confirm that
   pilot workflows no longer depend on the retired APIs.
2. Under a separate operator process, inventory retained server rows and agree
   retention/consent and a secure one-time local transfer with each owner.
   Verify reconciliation and encrypted backups. 5B adds no transfer endpoint.
3. Keep identity/licence tables: tenant, membership, invite, control audit,
   workspace_licence, licence_seat, licence_location and licence_device.
   Keep private actor verification material with its rotation/restore process.
   plan_feature remains non-authoritative until separately retired.
4. Propose a NEW reviewed migration for customer, product, price_list,
   price_list_version, price_list_item, margin_policy, quote, quote_line,
   approval, sales_order, rebate_agreement, rebate_progress, invoice,
   invoice_line, cost_component, supplier_credit, alert, margin_snapshot,
   connector_secret, import_job, cost_history, uom, uom_conversion, fx_rate,
   data_quality_issue, customer_group, customer_price, rebate_tier, rebate_entry,
   column_mapping_template, connector_sync_run, quote_share_link and approval_rule.
   Review FK dependencies and related functions first. Historical business
   snapshots in audit_log need an approved retention process too.
5. Prove control-plane operation and recovery on an isolated restore before
   final release approval. Only then retire dormant legacy modules/jobs.

Approve or revise this sequence and its retention/transfer requirements.
Approving 5B CI or its Restore Drill does **not** approve table retirement.
No 6A work is included.
