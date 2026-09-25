/**
 * `tl skill` — print the bundled Trunkline SKILL.md.
 *
 * The skill file is embedded at build time via a text import, so the compiled
 * binary carries it. This lets an AI agent pull the skill directly from the
 * tool:  `tl skill > SKILL.md`  or pipe it into an agent's context.
 */

import skillText from "../../../skills/trunkline/SKILL.md" with {
  type: "text",
};

export function runSkill(): number {
  console.log(skillText);
  return 0;
}

/** Exposed for tests. */
export const SKILL_TEXT: string = skillText;
