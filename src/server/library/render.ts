import type { CompiledEntry } from "./schema";

const DANGEROUS_CHARS = /['";|&`$()<>]/;
const DANGEROUS_CHARS_MSG =
  "value contains a forbidden character (' \" ; | & ` $ ( ) < >)";

export function renderCommand(
  script: Pick<CompiledEntry, "kind" | "command" | "params">,
  params: Record<string, string>
): { ok: true; command: string } | { ok: false; error: string } {
  if (script.kind !== "command" || !script.command) {
    return { ok: false, error: "script is not a command" };
  }

  let result = script.command;

  if (script.params) {
    for (const [name, param] of Object.entries(script.params)) {
      const placeholder = `{{${name}}}`;
      const value = params[name];
      if (value === undefined) {
        return { ok: false, error: `missing param "${name}"` };
      }

      if (DANGEROUS_CHARS.test(value) || value.includes("\n")) {
        return {
          ok: false,
          error: `param "${name}": ${DANGEROUS_CHARS_MSG}`
        };
      }

      if (param.type === "enum") {
        if (!param.values?.includes(value)) {
          return {
            ok: false,
            error: `param "${name}" must be one of: ${param.values?.join(", ")}`
          };
        }
      } else if (param.type === "regex" && param.pattern) {
        try {
          const re = new RegExp(param.pattern);
          if (!re.test(value)) {
            return {
              ok: false,
              error: `param "${name}" does not match the required pattern`
            };
          }
        } catch {
          return {
            ok: false,
            error: `param "${name}" has an invalid regex pattern`
          };
        }
      }

      result = result.split(placeholder).join(value);
    }
  }

  const remaining = result.match(/\{\{[^}]+\}\}/);
  if (remaining) {
    return {
      ok: false,
      error: `unsubstituted placeholder: ${remaining[0]}`
    };
  }

  return { ok: true, command: result };
}
