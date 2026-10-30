/**
 * 备份加密外壳：往返、错口令、篡改。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { decryptArchive, encryptArchive, isEncryptedArchive } from "../main/archive-cipher";

const PAYLOAD = Buffer.from("PK\u0003\u0004 not really a zip, but bytes are bytes", "utf8");

test("加密后不再是明文 ZIP，解密能还原原始字节", () => {
  const sealed = encryptArchive(PAYLOAD, "正确的口令-1");
  assert.equal(isEncryptedArchive(sealed), true);
  assert.equal(isEncryptedArchive(PAYLOAD), false);
  assert.notEqual(sealed.indexOf(PAYLOAD), 0, "原始内容不应出现在开头");
  assert.deepEqual(decryptArchive(sealed, "正确的口令-1"), PAYLOAD);
});

test("同一份内容两次加密的密文不同（随机 salt/iv）", () => {
  const a = encryptArchive(PAYLOAD, "pw");
  const b = encryptArchive(PAYLOAD, "pw");
  assert.notDeepEqual(a, b);
  assert.deepEqual(decryptArchive(a, "pw"), decryptArchive(b, "pw"));
});

test("口令错误会明确报错，不返回半截数据", () => {
  const sealed = encryptArchive(PAYLOAD, "right");
  assert.throws(() => decryptArchive(sealed, "wrong"), /口令不正确/);
});

test("密文被篡改会被 GCM 校验拦下", () => {
  const sealed = encryptArchive(PAYLOAD, "pw");
  const tampered = Buffer.from(sealed);
  const lastIndex = tampered.length - 1;
  tampered[lastIndex] = (tampered[lastIndex] ?? 0) ^ 0xff;
  assert.throws(() => decryptArchive(tampered, "pw"), /口令不正确|损坏/);
});

test("不是加密备份时直接拒绝", () => {
  assert.throws(() => decryptArchive(PAYLOAD, "pw"), /不是加密备份/);
});
