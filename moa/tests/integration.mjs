// Run against local Wrangler: node tests/integration.mjs
import assert from "node:assert/strict";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:8787";
async function call(path, method = "GET", body, token) {
  const r = await fetch(base + "/api" + path, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, data: await r.json() };
}
const health = await call("/health");
assert.equal(health.status, 200);
assert.deepEqual(health.data, { ok: true, database: true, photos: true });
const a = (
  await call("/create", "POST", { name: "통합 테스트", nickname: "A" })
).data;
assert.ok(a.token);
const b = (await call("/join", "POST", { code: a.code, nickname: "B" })).data;
const outsider = (
  await call("/create", "POST", { name: "다른 프로젝트", nickname: "C" })
).data;
try {
  const id = crypto.randomUUID(),
    item = {
      title: "둘이 다녀온 카페",
      category: "food",
      address: "서울",
      note: "함께",
      date: "",
      assignee: "",
      done: true,
      url: "",
      lat: 37.5,
      lng: 127,
    };
  assert.equal(
    (await call("/items/" + id, "PUT", { item, version: 0 }, a.token)).status,
    200,
  );
  assert.equal(
    (await call("/items", "GET", undefined, b.token)).data.items[0].title,
    item.title,
  );
  assert.equal(
    (
      await call(
        "/items/" + id,
        "PUT",
        { item: { ...item, note: "수정" }, version: 1 },
        b.token,
      )
    ).status,
    200,
  );
  assert.equal(
    (await call("/items/" + id, "PUT", { item, version: 1 }, a.token)).status,
    409,
  );
  assert.equal((await call("/items", "GET")).status, 401);
  assert.equal(
    (await call("/items", "GET", undefined, outsider.token)).data.items.length,
    0,
  );
  const photo = Buffer.from(
    "UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA",
    "base64",
  );
  let r = await fetch(base + "/api/photos?item=" + id, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + a.token,
      "Content-Type": "image/webp",
    },
    body: photo,
  });
  assert.equal(r.status, 200);
  const uploaded = await r.json();
  assert.equal(
    (await call("/photos?item=" + id, "GET", undefined, b.token)).data.photos[0]
      .id,
    uploaded.id,
  );
  assert.equal(
    (
      await fetch(base + "/api/photos/" + uploaded.id, {
        headers: { Authorization: "Bearer " + b.token },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(base + "/api/photos/" + uploaded.id, {
        headers: { Authorization: "Bearer " + outsider.token },
      })
    ).status,
    404,
  );
  assert.equal((await fetch(base + "/api/photos/" + uploaded.id)).status, 401);
  assert.equal(
    (
      await call(
        "/admin",
        "POST",
        { action: "rotate", admin: a.admin },
        a.token,
      )
    ).status,
    200,
  );
  assert.equal((await call("/items", "GET", undefined, b.token)).status, 401);
  assert.equal(
    (
      await call(
        "/admin",
        "POST",
        { action: "delete", admin: a.admin },
        a.token,
      )
    ).status,
    200,
  );
  assert.equal((await call("/items", "GET", undefined, a.token)).status, 401);
  console.log(
    "PASS: 코드 참여, 변경 공유, 버전 충돌, 비공개 사진, 타 프로젝트 차단, 코드 재발급, 삭제",
  );
} finally {
  await call("/admin", "POST", { action: "delete", admin: a.admin }, a.token);
  await call(
    "/admin",
    "POST",
    { action: "delete", admin: outsider.admin },
    outsider.token,
  );
}
