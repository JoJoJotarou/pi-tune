import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripDynamicSystemPromptFooter } from "./prompt.ts";

// Both fixtures are verbatim tails of a real request body captured from a local provider.
const BASE = "…rules from AGENTS.md…\n</docs>";

describe("stripDynamicSystemPromptFooter", () => {
  it("cuts the cwd block Pi appends, so the child can append it again unchanged", () => {
    const parent = `${BASE}\n\n<cwd>\n/private/tmp/probe/work\n</cwd>`;
    assert.equal(stripDynamicSystemPromptFooter(parent), BASE);
  });

  it("cuts the cwd block even when a prompt ends with a newline", () => {
    const parent = `${BASE}\n\n<cwd>\n/private/tmp/probe/work\n</cwd>\n`;
    assert.equal(stripDynamicSystemPromptFooter(parent), BASE);
  });

  it("cuts the older date and working-directory footer", () => {
    const parent = `${BASE}\nCurrent date and time: 2026-11-03 20:54\nCurrent working directory: /tmp/work`;
    assert.equal(stripDynamicSystemPromptFooter(parent), BASE);
    assert.equal(stripDynamicSystemPromptFooter(`${BASE}\nCurrent working directory: /tmp/work`), BASE);
  });

  it("leaves a prompt without a dynamic footer alone", () => {
    assert.equal(stripDynamicSystemPromptFooter(BASE), BASE);
    assert.equal(stripDynamicSystemPromptFooter(`${BASE}\n`), BASE);
  });

  it("only cuts the footer, never a <cwd> block quoted earlier in the prompt", () => {
    const quoted = `${BASE}\n\n<cwd>\n/earlier\n</cwd>\n\ntrailing note`;
    assert.equal(stripDynamicSystemPromptFooter(quoted), quoted);
  });
});
