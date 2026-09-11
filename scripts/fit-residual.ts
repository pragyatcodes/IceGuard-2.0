/**
 * Fits the residual weights on the FIT half of REPLAY_CASES and reports
 * held-out skill. The winning weights are committed to DEFAULT_RESIDUAL_MODEL
 * like a checkpoint. Run: npm run fit:residual
 */
import { fitResidualWeights, runReplay } from "@/lib/pipeline/replay";
import { DEFAULT_RESIDUAL_MODEL } from "@/lib/physics/residual";

const t0 = Date.now();
const f = fitResidualWeights({ trials: 260 });
console.log("fit-residual — bounded random search over 3 weights");
console.log("  trials           :", f.trials);
console.log("  elapsed          :", ((Date.now() - t0) / 1000).toFixed(1), "s");
console.log("  fitted weights   :", JSON.stringify(f.weights, (k, v) => (typeof v === "number" ? +v.toFixed(4) : v)));
console.log("  committed weights:", JSON.stringify(DEFAULT_RESIDUAL_MODEL.weights));
console.log("");
console.log("  FIT  split MAE48 :", f.fitMaeKm48.toFixed(2), "km");
console.log("  HOLD-OUT MAE48   :", f.holdoutMaeKm48.toFixed(2), "km   (physics-only:", f.holdoutPhysicsMaeKm48.toFixed(2), "km)");
console.log("  improvement      :", f.improvementPct.toFixed(1) + "% out of sample");
const s = runReplay();
console.log("");
console.log("  full replay MAE72: physics", s.maeKm.physics.h72.toFixed(2), "km -> model", s.maeKm.model.h72.toFixed(2), "km");
