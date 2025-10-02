# Loan settlement snapshot backfill

## Overview
Orders that were marked as `LN_SETTLED` before the snapshot schema update may have incomplete
metadata. The `loanSettlementHistory` and `lastLoanSettlement` entries now expect:

- `previousStatus`, `previousPendingAmount`, `previousSettlementStatus`,
  `previousSettlementAmount`, and `previousSettlementTime` values inside each snapshot.
- Loan entry details (`id`, `subMerchantId`, `amount`, `metadata`) captured in both
  `snapshot.loanEntry` and `snapshot.previousLoanEntry`.

The `scripts/backfillLoanSettlementSnapshots.ts` script inspects existing loan-settled orders and
fills the missing fields whenever the historical data is still available.

## Running the script
1. **Dry run (recommended):**
   ```bash
   npx ts-node scripts/backfillLoanSettlementSnapshots.ts --dry-run --batch=200
   ```
   This prints the orders that would be updated without modifying the database.

2. **Apply the changes:**
   ```bash
   npx ts-node scripts/backfillLoanSettlementSnapshots.ts --batch=200
   ```
   Adjust `--batch` (default `100`) as needed. You can also cap the run with `--limit=<count>`
   when testing in lower environments.

3. **Verify:**
   - Spot check a few updated orders to ensure `metadata.loanSettlementHistory[*].snapshot` and
     `metadata.lastLoanSettlement.snapshot` now contain the new fields.
   - Confirm that `loanEntry.metadata.previousLoanEntry` is present when an existing loan entry
     was overwritten.

## Historical reverts
After the backfill completes, historical orders that were already loan-settled gain the required
snapshot information so `revertLoanSettlementsByRange` can restore them safely. If you need to
revert a historical settlement:

1. Run the backfill script (if it has not been executed yet).
2. Use the usual revert tooling/API; the revert flow will reuse the backfilled snapshots.

## Notes
- The script only touches orders with `status = LN_SETTLED` and leaves other records untouched.
- Orders whose metadata is missing entirely are skipped; they will continue to require manual
  inspection.
- Always run the script in dry-run mode on production first to gauge the scope of the update.
