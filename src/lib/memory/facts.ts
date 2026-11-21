/** Pull "FACT: ..." lines out of a summary produced by the compaction model. */
export function splitFacts(raw: string) {
  const facts: string[] = [];
  const lines = raw.split("\n").filter((l) => {
    const m = l.match(/^\s*[-*]?\s*FACT:\s*(.+)$/i);
    if (m) facts.push(m[1].trim());
    return !m;
  });
  return { text: lines.join("\n").trim(), facts: facts.slice(0, 3) };
}
