// Reuse the existing real-handler/mobile acceptance with expanded time/type fixtures.
import { fileURLToPath } from 'node:url';
process.env.THUNDERLEDGER_EVIDENCE_DIR ??= fileURLToPath(new URL('./evidence/settlement/', import.meta.url));
await import('../20261009-settlement-member-filter/verify.mjs');
