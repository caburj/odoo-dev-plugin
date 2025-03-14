import * as assert from "assert";
import { inferBaseBranch } from "../../helpers";

suite("Extension Test Suite", () => {
  test("inferBaseBranch test", () => {
    assert.strictEqual(inferBaseBranch("master_asdasdf"), "master");
    assert.strictEqual(inferBaseBranch("master-asdfasd"), "master");
    assert.strictEqual(inferBaseBranch("saas-18.0-asdfsadf"), "saas-18.0");
    assert.strictEqual(inferBaseBranch("18.0-asdfasdf"), "18.0");
    assert.strictEqual(inferBaseBranch("17.0-asdsdaf"), "17.0");
    assert.strictEqual(inferBaseBranch("17.0_asdfsd"), "17.0");
  });
});
