import { describe, expect, it } from "vitest";
import {
  classifyRegime,
  couplingWeight,
  SIC_ICE_EDGE,
  SIC_LOCK,
} from "@/lib/physics/regimes";

describe("classifyRegime", () => {
  it("is OPEN below the ice edge", () => {
    expect(classifyRegime({ sic: 0.0, thicknessM: 0 })).toBe("OPEN");
    expect(classifyRegime({ sic: SIC_ICE_EDGE - 0.001, thicknessM: 0.4 })).toBe("OPEN");
  });

  it("is DRAG through the 15-90% band", () => {
    expect(classifyRegime({ sic: 0.4, thicknessM: 0.3 })).toBe("DRAG");
    expect(classifyRegime({ sic: 0.89, thicknessM: 0.6 })).toBe("DRAG");
  });

  it("is LOCK at high concentration with thick ice", () => {
    expect(classifyRegime({ sic: SIC_LOCK, thicknessM: 1.0 })).toBe("LOCK");
    expect(classifyRegime({ sic: 0.98, thicknessM: 2.5 })).toBe("LOCK");
  });

  it("refuses LOCK when the ice is too thin to trap a berg (L5)", () => {
    // 98% concentration of nilas is not a cage for a giant tabular berg.
    expect(classifyRegime({ sic: 0.98, thicknessM: 0.1 })).not.toBe("LOCK");
    expect(classifyRegime({ sic: 0.98, thicknessM: 0.1 })).toBe("DRAG");
  });
});

describe("couplingWeight", () => {
  it("is 0 in open water and 1 in lock", () => {
    expect(couplingWeight({ sic: 0.05, thicknessM: 0 })).toBe(0);
    expect(couplingWeight({ sic: 0.95, thicknessM: 1.5 })).toBe(1);
  });

  it("ramps monotonically across the drag band", () => {
    const ws = [0.2, 0.35, 0.5, 0.65, 0.8].map((sic) =>
      couplingWeight({ sic, thicknessM: 0.4 }),
    );
    for (let i = 1; i < ws.length; i++) {
      expect(ws[i]).toBeGreaterThan(ws[i - 1]);
    }
  });

  it("stays inside [0,1] everywhere", () => {
    for (let sic = 0; sic <= 1.0001; sic += 0.05) {
      const w = couplingWeight({ sic, thicknessM: 0.8 });
      expect(w).toBeGreaterThanOrEqual(0);
      expect(w).toBeLessThanOrEqual(1);
    }
  });
});
