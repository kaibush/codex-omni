import { parser as cssParser } from "@lezer/css";
import { parser as jsParser } from "@lezer/javascript";

export type AssetKind = "style" | "script" | "module" | "media" | "data";
type Reference = {
  from: number;
  to: number;
  value: string;
  kind: AssetKind;
  documentRelative?: boolean;
};

export async function rewriteReferences(
  text: string,
  language: "css" | "js",
  resolve: (reference: Reference) => Promise<string>
) {
  const refs: Reference[] = [];
  if (language === "css" && /url\s*\(|@import/i.test(text)) {
    cssParser.parse(text).iterate({
      enter({ node }) {
        const call = node.parent;
        const quoted = node.name === "StringLiteral";
        if (!quoted && node.name !== "ParenthesizedContent") return;
        const url =
          call?.name === "CallLiteral" &&
          text.slice(call.from, call.firstChild?.to).toLowerCase() === "url";
        const imported = (url ? call.parent : call)?.name === "ImportStatement";
        if (!url && !imported) return;
        refs.push({
          from: node.from,
          to: node.to,
          value: text.slice(node.from + Number(quoted), node.to - Number(quoted)).trim(),
          kind: imported ? "style" : "media"
        });
      }
    });
  } else if (language === "js" && /\b(?:import|export|fetch|URL|src|poster|Audio)\b/.test(text)) {
    jsParser.parse(text).iterate({
      enter({ node }) {
        if (node.name !== "String") return;
        const parent = node.parent;
        const value = text.slice(node.from + 1, node.to - 1);
        if (value.includes("\\")) return;
        if (
          parent &&
          ["ImportDeclaration", "ExportDeclaration", "DynamicImport"].includes(parent.name)
        ) {
          if (!/^(?:\.{1,2}\/|https?:\/\/|\/\/)/i.test(value)) return;
          refs.push({ from: node.from, to: node.to, value, kind: "module" });
        } else if (
          parent?.name === "AssignmentExpression" &&
          node.prevSibling?.name === "Equals" &&
          /\.(?:src|poster)\s*$/.test(text.slice(parent.from, node.prevSibling.from))
        ) {
          const kind = /\.m?js(?:[?#]|$)/i.test(value) ? "script" : "media";
          refs.push({ from: node.from, to: node.to, value, kind, documentRelative: true });
        } else if (parent?.name === "ArgList" && node.prevSibling?.name === "(") {
          const expression = parent.parent;
          const callee = text.slice(expression?.from, parent.from).trim();
          const documentRelative =
            (expression?.name === "CallExpression" && callee === "fetch") ||
            (expression?.name === "NewExpression" && /^new\s+Audio$/.test(callee));
          const moduleRelative =
            expression?.name === "NewExpression" &&
            /^new\s+URL$/.test(callee) &&
            /^\s*,\s*import\.meta\.url\s*\)$/.test(text.slice(node.to, parent.to));
          if (documentRelative || moduleRelative)
            refs.push({ from: node.from, to: node.to, value, kind: "data", documentRelative });
        }
      }
    });
  }
  const parts: string[] = [];
  let start = 0;
  for (const ref of refs) {
    const replacement = await resolve(ref);
    if (replacement === ref.value) continue;
    parts.push(text.slice(start, ref.from), JSON.stringify(replacement));
    start = ref.to;
  }
  return parts.join("") + text.slice(start);
}
