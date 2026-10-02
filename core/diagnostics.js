export function executionDiagnostic(error, phase = "execution") {
  const message = String(error?.message ?? error ?? "Unknown script error");
  const match =
    message.match(/(?:at\s+)?line\s+(\d+)(?:[,:]\s*(?:column\s*)?(\d+))?/i) ??
    message.match(
      /(?:Unexpected token[^\n]*|Pine Script[^\n]*)at\s+(\d+):(\d+)/i,
    );
  const line =
    Number(error?.loc?.start?.line ?? error?.lineNumber ?? match?.[1]) || null;
  const column =
    Number(error?.loc?.start?.column ?? error?.columnNumber ?? match?.[2]) ||
    null;
  return {
    message,
    phase,
    line,
    column,
    hint:
      phase === "compile"
        ? "Check Pine syntax, indentation and supported PineTS features."
        : "Check input values, available data and PineTS feature support. A JavaScript stack line is not assumed to be a Pine source line.",
  };
}
