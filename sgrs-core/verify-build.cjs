#!/usr/bin/env node
// Post-build verification: ensures the native addon exports all critical functions.
// Run automatically via `npm run build` (postbuild hook).
const m = require('./index.js');
const fns = [
  'evaluateKernel',
  'evaluateVectorFinalityBridge',
  'analyzeConvergenceBridge',
  'computeGoalScoreBridge',
  'evaluateGatesBridge',
  'computeContentHashBridge',
  'validateContributionBridge',
  'computeDisagreementBridge',
  'analyzeSpectrumBridge',
  'analyzeIssBridge',
  'propagationStepBridge',
  'extractContradictionsBridge',
];
const missing = fns.filter(f => typeof m[f] !== 'function');
if (missing.length) {
  console.error('BUILD VERIFICATION FAILED — missing exports:', missing.join(', '));
  console.error('Did you forget --platform? Use: npm run build');
  process.exit(1);
}
console.log(`Build verified: all ${fns.length} critical exports present.`);
