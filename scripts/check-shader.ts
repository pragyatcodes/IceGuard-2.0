import { parser } from "@shaderfrog/glsl-parser";
import { SMOKE_FRAG_SRC, SMOKE_VERT_SRC } from "../src/lib/bg/smoke-shader";

for (const [name, src] of [["vertex", SMOKE_VERT_SRC], ["fragment", SMOKE_FRAG_SRC]] as const) {
  try {
    const ast = parser.parse(src) as { functions?: { name: string }[] };
    const fns = (ast.functions ?? []).map((f) => f.name);
    console.log(`${name}: PARSE OK  fns=[${fns.join(", ")}]`);
  } catch (e) {
    console.log(`${name}: PARSE FAIL`);
    console.log(String(e).slice(0, 1200));
    process.exit(1);
  }
}
