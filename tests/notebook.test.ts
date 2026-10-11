import assert from "node:assert/strict";
import { test } from "node:test";
import { getNotebookUrl, notebookHref, NOTEBOOKLM_HOME } from "../src/lib/notebook";

test("preserves official notebook URLs and accepts copied Markdown or hidden HTTPS", () => {
  const target = "https://notebook.google.com/notebook/test-course?authuser=1";
  assert.equal(getNotebookUrl(`[Notebook](${target})`), target);
  assert.equal(getNotebookUrl("notebook.google.com/notebook/test-course?authuser=1"), target);
  for (const host of ["notebooklm.google", "notebooklm.google.com", "notebook.google.com"]) {
    assert.equal(getNotebookUrl(`https://${host}/notebook/test`), `https://${host}/notebook/test`);
  }
});

test("rejects lookalike hosts and unsafe links instead of exposing browser keys", () => {
  for (const value of ["javascript:alert(1)", "http://notebook.google.com/", "https://notebook.google.com.attacker.example/", "https://user:password@notebook.google.com/", "https://notebook.google.com:8443/", "[Notebook](https://attacker.example/)"]) {
    assert.equal(getNotebookUrl(value), null);
    assert.equal(notebookHref(value), NOTEBOOKLM_HOME);
  }
});
