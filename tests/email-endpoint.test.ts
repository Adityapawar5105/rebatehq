// Review R3: invitation emails go to Resend unless RESEND_API_URL names another https endpoint, or http on this machine.
import test from "node:test";
import assert from "node:assert/strict";
import { resendEmailsUrl } from "../lib/email-endpoint";

test("R3: invitation email endpoint defaults to Resend and accepts only https or local http", () => {
  assert.equal(resendEmailsUrl({}), "https://api.resend.com/emails");
  assert.equal(resendEmailsUrl({ RESEND_API_URL: "http://127.0.0.1:3099" }), "http://127.0.0.1:3099/emails");
  assert.equal(resendEmailsUrl({ RESEND_API_URL: "https://mail.example.test/v1/" }), "https://mail.example.test/v1/emails");
  for (const bad of ["http://mail.example.test", "ftp://127.0.0.1", "https://user:pw@mail.example.test", "https://mail.example.test/?x=1", "not a url"])
    assert.throws(() => resendEmailsUrl({ RESEND_API_URL: bad }), /RESEND_API_URL/, bad);
});
